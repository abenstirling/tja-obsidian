import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {readFileSync, writeFileSync, mkdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {PDFDocument} from 'pdf-lib';
import {prepareNote, outputFolder, safeBasename, starterResume, localDate, pdfBasename} from '../note';
import {fillThreshold, pageLint} from '../lint';
import {demoMarkdown} from './fixtures';
import {layoutResume} from '../src/shared/resume-layout';

// Execute the actual shipped CommonJS bundle with only the Obsidian host mocked.
// This catches missing runtime imports, packaging errors, and PDF export failures.
execFileSync(process.execPath, ['build.mjs']);
const notices: string[] = [];
class File {
  extension = 'md';
  basename = 'Resume';
  parent = {path: 'Career'};
  path = 'Career/Resume.md';
}
class Folder { constructor(public path: string) {} }
class Element {
  children: Element[] = [];
  textContent = '';
  disabled = false;
  value = '';
  checked = false;
  attrs: Record<string, string> = {};
  events = new Map<string, (() => any)[]>();
  get win() { return globalThis; }
  createSvg(tag: string) { return this.createEl(tag); }
  get ownerDocument() { return fakeDocument; }
  get namespaceURI() { return 'http://www.w3.org/2000/svg'; }
  createEl(_tag: string, options: any = {}) {
    const element = new Element();
    element.textContent = options.text || '';
    element.value = options.value || '';
    if (options.cls) element.attrs.class = options.cls;
    this.children.push(element);
    return element;
  }
  createDiv(options: any = {}) { return this.createEl('div', options); }
  createSpan(options: any = {}) { return this.createEl('span', options); }
  appendChild(element: Element) { this.children.push(element); return element; }
  setText(value: string) { this.textContent = value; }
  setAttribute(name: string, value: string) { this.attrs[name] = value; }
  addClass(value: string) { this.attrs.class = (this.attrs.class || '') + ' ' + value; }
  toggleClass(value: string, enabled: boolean) { if (enabled) this.addClass(value); else this.attrs.class = (this.attrs.class || '').replace(value, ''); }
  empty() { this.children = []; this.textContent = ''; }
  remove() {}
  addEventListener(type: string, callback: () => any) { this.events.set(type, [...this.events.get(type) || [], callback]); }
  click() { if (!this.disabled) for (const callback of this.events.get('click') || []) callback(); }
  change(value: string) { this.value = value; for (const callback of this.events.get('change') || []) callback(); }
  text(): string { return this.textContent + this.children.map(child => child.text()).join(' '); }
}
const fakeDocument = {createElementNS: () => new Element()};
class MarkdownView {
  addAction = vi.fn(() => new Element());
}
class ItemView {
  app: any;
  contentEl = new Element();
  registrations: any[] = [];
  constructor(public leaf: any) { this.app = leaf.app; }
  async setState() {}
  registerEvent(ref: any) { this.registrations.push(ref); }
  registerDomEvent(element: Element, event: string, callback: () => any) { element.addEventListener(event, callback); }
}
class Plugin {
  commands: any[] = [];
  viewFactories = new Map<string, (leaf: any) => any>();
  constructor(public app: any) {}
  loadData = vi.fn(async () => null);
  saveData = vi.fn(async () => {});
  addCommand(command: any) { this.commands.push(command); }
  addSettingTab = vi.fn();
  addRibbonIcon = vi.fn();
  registerView(type: string, factory: (leaf: any) => any) { this.viewFactories.set(type, factory); }
  registerEvent() {}
}
const obsidian = {
  Plugin, MarkdownView, ItemView, TFile: File, TFolder: Folder,
  PluginSettingTab: class {}, Setting: class {},
  Notice: class { constructor(message: string) { notices.push(message); } },
  normalizePath: (path: string) => path.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
};
const module = {exports: {} as any};
new Function('module', 'exports', 'require', readFileSync('release/resume-pdf/main.js', 'utf8'))(
  module, module.exports, (name: string) => {
    if (name !== 'obsidian') throw new Error(`Unexpected runtime dependency: ${name}`);
    return obsidian;
  }
);
const ResumePDF = module.exports.default;

function host() {
  const file = new File();
  const files = new Map<string, any>([[file.path, file], ['Career', new Folder('Career')]]);
  const buffers = new Map<string, ArrayBuffer>();
  const editor = {getValue: vi.fn(() => demoMarkdown)};
  const view = Object.assign(new MarkdownView(), {file, editor, leaf: null as any});
  const openFile = vi.fn(async () => {});
  const listeners = new Map<string, Set<(...args: any[]) => any>>();
  const on = vi.fn((name: string, callback: (...args: any[]) => any) => {
    if (!listeners.has(name)) listeners.set(name, new Set());
    listeners.get(name)!.add(callback);
    return {off: () => listeners.get(name)!.delete(callback)};
  });
  const emit = (name: string, ...args: any[]) => { for (const callback of [...listeners.get(name) || []]) callback(...args); };
  const previewLeaves: any[] = [];
  const sourceLeaf: any = {view, getViewState: () => ({type: 'markdown', state: {file: file.path}}), setViewState: vi.fn(async () => {})};
  view.leaf = sourceLeaf;
  const app = {
    workspace: {
      getActiveFile: vi.fn(() => file), getActiveViewOfType: vi.fn(() => view),
      getLeaf: vi.fn(() => ({openFile})), on,
      onLayoutReady: vi.fn((callback: () => void) => callback()),
      getLeavesOfType: vi.fn((type: string) => type === 'markdown' ? [sourceLeaf] : previewLeaves),
      createLeafBySplit: vi.fn(() => {
        const leaf: any = {app, view: null};
        leaf.setViewState = vi.fn(async (state: any) => {
          if (!leaf.view) {
            leaf.view = plugin.viewFactories.get(state.type)!(leaf);
            await leaf.view.onOpen();
          }
          await leaf.view.setState(state.state, {});
        });
        previewLeaves.push(leaf);
        return leaf;
      }),
      setActiveLeaf: vi.fn(),
      detachLeavesOfType: vi.fn()
    },
    vault: {
      on,
      read: vi.fn(async () => demoMarkdown),
      getAbstractFileByPath: vi.fn((path: string) => files.get(path)),
      createFolder: vi.fn(async (path: string) => { files.set(path, new Folder(path)); }),
      createBinary: vi.fn(async (path: string, bytes: ArrayBuffer) => {
        if (files.has(path)) throw new Error('File already exists');
        const pdf = Object.assign(new File(), {path, extension: 'pdf'});
        files.set(path, pdf); buffers.set(path, bytes); return pdf;
      }),
      create: vi.fn(async (path: string, text: string) => {
        if (files.has(path)) throw new Error('File already exists');
        const created = Object.assign(new File(), {path});
        files.set(path, created); return created;
      })
    }
  };
  sourceLeaf.app = app;
  const plugin = new ResumePDF(app);
  return {app, file, files, buffers, editor, view, openFile, plugin, emit, listeners, previewLeaves, sourceLeaf};
}

describe('community review regressions', () => {
  it('leaves workspace panes in place when the plugin unloads', async () => {
    const {plugin, app, previewLeaves} = host();
    await plugin.onload();
    await plugin.preview();
    expect(previewLeaves).toHaveLength(1);
    plugin.onunload();
    expect(app.workspace.detachLeavesOfType).not.toHaveBeenCalled();
  });

  it('ships preview fonts as CSS and excludes script/style injection from the bundle', () => {
    const bundle = readFileSync('release/resume-pdf/main.js', 'utf8');
    const css = readFileSync('release/resume-pdf/styles.css', 'utf8');
    expect(bundle).not.toMatch(/createElement\(\s*['"](?:script|style)['"]/);
    expect(bundle).not.toContain('cdnjs.cloudflare.com');
    expect(css.match(/@font-face/g)).toHaveLength(5);
    expect(css).toContain('data:font/ttf;base64,');
    expect(css).toContain('white-space: pre');
    expect(css).not.toContain('!important');
  });

  it('validates stored settings and exposes searchable setting definitions', async () => {
    const {plugin} = host();
    plugin.loadData.mockResolvedValue({minimumFill: 'invalid', folder: 7, template: 'invalid', accentColor: null, openAfterExport: 'yes'});
    await plugin.onload();
    expect(plugin.settings).toMatchObject({minimumFill: 85, folder: '', template: 'classic', openAfterExport: true});
    const tab = plugin.addSettingTab.mock.calls[0][0];
    expect(tab.getSettingDefinitions().map((definition: {name: string}) => definition.name)).toEqual(['Export folder', 'Minimum page fill', 'Open PDF after export']);
  });
});

describe('Obsidian note preparation', () => {
  it('omits frontmatter and preserves the original line offset with BOM and CRLF', () => {
    const note = prepareNote('\uFEFF---\r\ntags: [resume]\r\n---\r\n\r\n' + demoMarkdown.replaceAll('\n', '\r\n'));
    expect(note).toEqual({markdown: demoMarkdown, lineOffset: 4});
    expect(prepareNote('\n\n' + demoMarkdown).lineOffset).toBe(2);
    expect(prepareNote('---\ntags: []\n...\n' + demoMarkdown).lineOffset).toBe(3);
  });
  it('reports unclosed properties and unsupported Obsidian content without silently dropping it', () => {
    expect(() => prepareNote('---\ntags: [resume]')).toThrow('Close the note properties');
    for (const line of ['[[Private note]]', '![[photo.png]]', '%% Hidden text %%', '| table |', '1. Ordered', '* Star bullet', '  - Nested']) {
      expect(() => prepareNote(`${demoMarkdown}\n${line}`)).toThrow('Line ');
    }
  });
  it('limits output folders to ordinary vault-relative paths', () => {
    expect(outputFolder('  Exports\\Resumes/ ')).toBe('Exports/Resumes');
    expect(outputFolder('')).toBe('');
    for (const path of ['../outside', '/tmp', '.obsidian/plugins', 'Exports/../notes', 'a//b', 'C:\\Users', 'a/\u0000b']) expect(() => outputFolder(path)).toThrow();
    expect(safeBasename('Resume: Design?')).toBe('Resume- Design-');
    expect(layoutResume(starterResume).ok).toBe(true);
  });
});

describe('compiled Obsidian plugin', () => {
  beforeEach(() => { notices.length = 0; });
  afterEach(() => { vi.useRealTimers(); });
  it('loads, registers commands and uses the editor buffer instead of a stale disk note', async () => {
    const {plugin, app, editor} = host();
    await plugin.onload();
    expect(plugin.commands.map((command: any) => command.id)).toEqual(['preview', 'export', 'starter']);
    editor.getValue.mockReturnValue('---\ntags: [resume]\n---\n\n' + demoMarkdown.replace('Alex Morgan', 'Élodie García'));
    const snapshot = await plugin.snapshot();
    expect(snapshot.markdown).toContain('Élodie García');
    expect(snapshot.lineOffset).toBe(4);
    expect(app.vault.read).not.toHaveBeenCalled();
    expect(plugin.commands[1].checkCallback(true)).toBe(true);
    expect(app.vault.createBinary).not.toHaveBeenCalled();
  });
  it('always enforces one page for both templates, ignoring an old saved opt-out', async () => {
    for (const template of ['classic', 'pepperdine', 'plumeria']) {
      const {plugin, editor, previewLeaves, buffers} = host();
      plugin.loadData.mockResolvedValue({template, enforceOnePage: false});
      await plugin.onload();
      editor.getValue.mockReturnValue(demoMarkdown + '\n' + '- Another achievement with useful details.\n'.repeat(100));
      await plugin.preview();
      const preview = previewLeaves[0].view;
      expect(preview.status.text()).toBe('Error — more than one page');
      expect(preview.contentEl.text()).not.toContain('Enforce 1 page');
      expect(preview.page.text()).not.toContain('preview guide');
      expect(preview.saveButton.disabled).toBe(true);
      expect(await plugin.exportSnapshot(await plugin.snapshot())).toBe(false);
      expect(buffers.size).toBe(0);
      editor.getValue.mockReturnValue(demoMarkdown);
      expect(await plugin.exportSnapshot(await plugin.snapshot())).toBe(true);
      expect((await PDFDocument.load([...buffers.values()][0])).getPageCount()).toBe(1);
    }
  });
  it('defaults to blue, saves the picked accent, restores it, and includes it in the captured preview', async () => {
    const {plugin, previewLeaves, editor} = host();
    await plugin.onload(); await plugin.preview();
    const preview = previewLeaves[0].view;
    expect(preview.colorPicker.value).toBe('#5fa8d3');
    preview.colorPicker.change('#cc3366');
    await Promise.resolve(); await Promise.resolve();
    expect(plugin.saveData).toHaveBeenLastCalledWith(expect.objectContaining({accentColor: '#cc3366'}));
    expect(preview.current.accentColor).toBe('#cc3366');
    expect(preview.current.layout.lines.some((line: any) => line.color === '#cc3366')).toBe(true);
    expect(preview.current.layout.lines.some((line: any) => line.color === '#5fa8d3')).toBe(false);
    expect(editor.getValue()).toBe(demoMarkdown);
    const restored = host().plugin;
    restored.loadData.mockResolvedValue({accentColor: '#cc3366'});
    await restored.onload();
    expect((await restored.snapshot()).accentColor).toBe('#cc3366');
    restored.loadData.mockResolvedValue({accentColor: 'invalid'});
    await restored.onload();
    expect(restored.settings.accentColor).toBe('#5fa8d3');
  });
  it('creates portable Markdown from the selected template using the preview button', async () => {
    const {plugin, app, previewLeaves} = host();
    await plugin.onload(); await plugin.preview();
    plugin.settings.template = 'plumeria';
    const showPreview = vi.spyOn(plugin, 'preview').mockResolvedValue(undefined);
    const find = (element: Element): Element | undefined => element.textContent === 'New resume' ? element : element.children.map(find).find(Boolean);
    find(previewLeaves[0].view.contentEl)!.click();
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(app.vault.create).toHaveBeenCalledWith('Career/Resume - Plumeria.md', readFileSync('Ben Stirling example.md', 'utf8'));
    expect(showPreview).toHaveBeenCalledWith(expect.objectContaining({path: 'Career/Resume - Plumeria.md'}));
    for (const template of ['classic', 'pepperdine', 'plumeria'] as const) expect(layoutResume(starterResume, template).ok).toBe(true);
  });
  it('exports with the resume name and editable company and automatic date without changing the note', async () => {
    const {plugin, editor, previewLeaves, buffers, file} = host();
    await plugin.onload(); await plugin.preview();
    const preview = previewLeaves[0].view;
    expect(preview.companyInput.value).toBe('');
    expect(preview.dateInput).toBeUndefined();
    expect(preview.filenameLabel.text()).toBe(`Alex Morgan_${localDate()}.pdf`);
    preview.companyInput.change('Acme');
    expect(preview.filenameLabel.text()).toBe(`Alex Morgan_Acme_${localDate()}.pdf`);
    expect(await plugin.exportSnapshot(preview.current)).toBe(true);
    expect(buffers.has(`Career/Alex Morgan_Acme_${localDate()}.pdf`)).toBe(true);
    preview.companyInput.change('');
    expect(preview.filenameLabel.text()).toBe(`Alex Morgan_${localDate()}.pdf`);
    expect(editor.getValue()).toBe(demoMarkdown);
    expect(plugin.exportDetails({...file, path: 'Different.md'}).company).toBe('');

  });
  it('reads an inactive context-menu note from the vault', async () => {
    const {plugin, app} = host();
    const other = Object.assign(new File(), {path: 'Career/Other.md'});
    await plugin.snapshot(other);
    expect(app.vault.read).toHaveBeenCalledWith(other);
  });
  it('exports a real one-page Letter PDF and numbers copies without replacing existing files', async () => {
    const {plugin, buffers, files, openFile} = host();
    const original = Object.assign(new File(), {path: `Career/Alex Morgan_${localDate()}.pdf`, extension: 'pdf'});
    files.set(original.path, original);
    const snapshot = await plugin.snapshot();
    expect(await plugin.exportSnapshot(snapshot)).toBe(true);
    expect(await plugin.exportSnapshot(snapshot)).toBe(true);
    expect([...buffers.keys()]).toEqual([`Career/Alex Morgan_${localDate()} (2).pdf`, `Career/Alex Morgan_${localDate()} (3).pdf`]);
    expect(files.get(original.path)).toBe(original);
    const bytes = buffers.get(`Career/Alex Morgan_${localDate()} (2).pdf`)!;
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBe(1);
    expect(pdf.getPage(0).getSize()).toEqual({width: 612, height: 792});
    expect(openFile).toHaveBeenCalledTimes(2);
    if (process.env.RESUME_PDF_QA) {
      mkdirSync('dist/test', {recursive: true});
      writeFileSync('dist/test/obsidian-resume.pdf', Buffer.from(bytes));
    }
  });
  it('exports at vault root and creates a configured nested folder', async () => {
    const {plugin, file, buffers, app, openFile} = host();
    file.parent.path = '/'; file.path = 'Resume.md';
    plugin.settings.openAfterExport = false;
    expect(await plugin.exportSnapshot(await plugin.snapshot())).toBe(true);
    expect(buffers.has(`Alex Morgan_${localDate()}.pdf`)).toBe(true);
    expect(openFile).not.toHaveBeenCalled();
    plugin.settings.folder = 'Exports/Resumes';
    expect(await plugin.exportSnapshot(await plugin.snapshot())).toBe(true);
    expect(buffers.has(`Exports/Resumes/Alex Morgan_${localDate()}.pdf`)).toBe(true);
    expect(app.vault.createFolder.mock.calls).toEqual([['Exports'], ['Exports/Resumes']]);
  });
  it('blocks overflow, unsupported glyphs and invalid Markdown before writing any PDF', async () => {
    const {plugin, editor, app} = host();
    for (const text of [demoMarkdown + '\n- Achievement 🚀', 'Not a resume', demoMarkdown + '\n' + '- This line describes a long work achievement.\n'.repeat(100)]) {
      editor.getValue.mockReturnValue(text);
      expect(await plugin.exportSnapshot(await plugin.snapshot())).toBe(false);
    }
    expect(app.vault.createBinary).not.toHaveBeenCalled();
    expect(notices.some(message => message.includes('cannot render'))).toBe(true);
    expect(notices.some(message => message.includes('one-page limit'))).toBe(true);
  });
  it('keeps a saved PDF when opening the viewer fails and reports the actual outcome', async () => {
    const {plugin, openFile, buffers} = host();
    openFile.mockRejectedValue(new Error('Viewer unavailable'));
    expect(await plugin.exportSnapshot(await plugin.snapshot())).toBe(true);
    expect(buffers.size).toBe(1);
    expect(notices.at(-1)).toContain('viewer could not open');
  });
  it('reports write failures and allows a later export to succeed', async () => {
    const {plugin, app} = host();
    app.vault.createBinary.mockRejectedValueOnce(new Error('Disk full'));
    const snapshot = await plugin.snapshot();
    expect(await plugin.exportSnapshot(snapshot)).toBe(false);
    expect(notices.at(-1)).toContain('Disk full');
    expect(await plugin.exportSnapshot(snapshot)).toBe(true);
  });
  it('creates a starter without changing an existing resume', async () => {
    const {plugin, app, files} = host();
    await plugin.onload();
    await plugin.commands.find((command: any) => command.id === 'starter').callback();
    expect(app.vault.create).toHaveBeenCalledWith('Career/Resume - Salt.md', readFileSync('Ben Stirling example.md', 'utf8'));
    expect(files.has('Career/Resume.md')).toBe(true);
  });
  it('exposes The Jobs Application button and opens one preview to the right of the Markdown editor', async () => {
    const {plugin, app, view, sourceLeaf, previewLeaves} = host();
    await plugin.onload();
    expect(plugin.addRibbonIcon).toHaveBeenCalledWith('panels-left-right', 'The Jobs Application', expect.any(Function));
    expect(view.addAction).toHaveBeenCalledWith('panels-left-right', 'The Jobs Application', expect.any(Function));
    await plugin.preview();
    expect(app.workspace.createLeafBySplit).toHaveBeenCalledWith(sourceLeaf, 'vertical');
    expect(sourceLeaf.setViewState).not.toHaveBeenCalled();
    expect(previewLeaves[0].view.getDisplayText()).toBe('The Jobs Application');
    expect(previewLeaves[0].view.page.text()).toContain('Alex Morgan');
    expect(app.workspace.setActiveLeaf).toHaveBeenLastCalledWith(sourceLeaf, {focus: true});
    await plugin.preview();
    expect(app.workspace.createLeafBySplit).toHaveBeenCalledTimes(1);
  });
  it('updates live from unsaved edits, disables export while updating, and recovers from invalid input', async () => {
    vi.useFakeTimers();
    const {plugin, editor, view, emit, previewLeaves, app} = host();
    await plugin.onload(); await plugin.preview();
    const preview = previewLeaves[0].view;
    expect(preview.saveButton.disabled).toBe(false);
    editor.getValue.mockReturnValue(demoMarkdown.replace('Alex Morgan', 'Élodie García'));
    emit('editor-change', editor, view);
    expect(preview.saveButton.disabled).toBe(true);
    await vi.advanceTimersByTimeAsync(121);
    expect(preview.page.text()).toContain('Élodie García');
    expect(preview.saveButton.disabled).toBe(false);
    expect(app.vault.read).not.toHaveBeenCalled();
    editor.getValue.mockReturnValue(demoMarkdown + '\n[[Unsupported link]]');
    emit('editor-change', editor, view);
    await vi.advanceTimersByTimeAsync(121);
    expect(preview.saveButton.disabled).toBe(true);
    expect(preview.page.children).toHaveLength(0);
    expect(preview.status.text()).toContain('Wiki links');
    editor.getValue.mockReturnValue(demoMarkdown);
    emit('editor-change', editor, view);
    await vi.advanceTimersByTimeAsync(121);
    expect(preview.saveButton.disabled).toBe(false);
  });
  it('switches templates from the dropdown without changing the Markdown and saves the preference', async () => {
    const {plugin, editor, previewLeaves, buffers} = host();
    await plugin.onload(); await plugin.preview();
    const preview = previewLeaves[0].view;
    expect(preview.templateSelect.children.map((option: Element) => option.textContent)).toEqual(['Salt', 'Pepper', 'Plumeria']);
    expect(preview.current.layout.template).toBe('classic');
    preview.templateSelect.change('pepperdine');
    expect(preview.saveButton.disabled).toBe(true);
    await Promise.resolve(); await Promise.resolve();
    expect(preview.current.layout.template).toBe('pepperdine');
    expect(preview.current.markdown).toBe(demoMarkdown);
    expect(editor.getValue()).toBe(demoMarkdown);
    expect(preview.page.text()).toContain('ALEX MORGAN');
    expect(plugin.saveData).toHaveBeenLastCalledWith(expect.objectContaining({template: 'pepperdine'}));
    expect(preview.saveButton.disabled).toBe(false);
    const captured = preview.current;
    plugin.settings.template = 'classic';
    expect(await plugin.exportSnapshot(captured)).toBe(true);
    expect((await PDFDocument.load([...buffers.values()][0])).getPageCount()).toBe(1);
  });
  it('renders Plumeria with its sans-serif font, saved accent, and unchanged Markdown', async () => {
    const {plugin, editor, previewLeaves, buffers} = host();
    plugin.loadData.mockResolvedValue({template: 'plumeria', accentColor: '#347c91'});
    await plugin.onload(); await plugin.preview();
    const preview = previewLeaves[0].view;
    const layout = preview.current.layout;
    expect(layout.template).toBe('plumeria');
    expect(preview.colorLabel.hidden).toBe(false);
    expect(layout.lines.find((line: any) => line.text === 'ALEX').size).toBe(36);
    expect(layout.lines.find((line: any) => line.text === 'MORGAN').color).toBe('#347c91');
    expect(layout.lines.some((line: any) => line.text === '01')).toBe(true);
    expect(layout.lines.some((line: any) => line.text === 'EXPERIENCE' && line.x < 100)).toBe(true);
    expect(layout.rules[0].color).toBe('#347c91');
    expect(layout.lines.every((line: any) => line.left >= layout.page.left - .01 && line.right <= layout.page.width - layout.page.right + .01 && line.bottom <= 756.01)).toBe(true);
    expect(editor.getValue()).toBe(demoMarkdown);
    expect(await plugin.exportSnapshot(preview.current)).toBe(true);
    expect((await PDFDocument.load([...buffers.values()][0])).getPageCount()).toBe(1);
    expect(preview.page.text()).toContain('40,000 monthly users');
    expect(preview.page.text()).toContain('24%');
  });
  it('restores a saved template preference and falls back safely for unknown values', async () => {
    const {plugin} = host();
    plugin.loadData.mockResolvedValue({template:'pepperdine'});
    await plugin.onload();
    expect((await plugin.snapshot()).layout.template).toBe('pepperdine');
    const other = host().plugin;
    other.loadData.mockResolvedValue({template:'unrecognized-template'});
    await other.onload();
    expect((await other.snapshot()).layout.template).toBe('classic');
  });
  it('ignores unrelated notes and prevents a slow older render from replacing a newer edit', async () => {
    vi.useFakeTimers();
    const {plugin, editor, view, emit, previewLeaves} = host();
    await plugin.onload(); await plugin.preview();
    const preview = previewLeaves[0].view;
    const original = plugin.snapshot.bind(plugin);
    let completeOld: (value: any) => void = () => {};
    const oldSnapshot = await original();
    const oldCall = new Promise(resolve => { completeOld = resolve; });
    vi.spyOn(plugin, 'snapshot').mockReturnValueOnce(oldCall);
    emit('editor-change', editor, view);
    await vi.advanceTimersByTimeAsync(121);
    editor.getValue.mockReturnValue(demoMarkdown.replace('Alex Morgan', 'New Name'));
    emit('editor-change', editor, view);
    await vi.advanceTimersByTimeAsync(121);
    completeOld(oldSnapshot);
    await Promise.resolve(); await Promise.resolve();
    expect(preview.page.text()).toContain('New Name');
    emit('editor-change', {getValue: () => 'Other note'}, {file: {path: 'Other.md'}});
    await vi.advanceTimersByTimeAsync(121);
    expect(preview.page.text()).toContain('New Name');
  });
  it('exports the live snapshot while the preview is focused and keeps the preview open', async () => {
    vi.useFakeTimers();
    const {plugin, app, editor, view, emit, previewLeaves} = host();
    await plugin.onload(); await plugin.preview();
    const preview = previewLeaves[0].view;
    app.workspace.getActiveViewOfType.mockReturnValue(null as any);
    app.workspace.getActiveFile.mockReturnValue(null as any);
    editor.getValue.mockReturnValue(demoMarkdown.replace('Alex Morgan', 'Latest Name'));
    emit('editor-change', editor, view);
    await vi.advanceTimersByTimeAsync(121);
    const exported = vi.spyOn(plugin, 'exportSnapshot').mockResolvedValue(true);
    preview.saveButton.click();
    await Promise.resolve(); await Promise.resolve();
    expect((exported.mock.calls[0][0] as {markdown: string}).markdown).toContain('Latest Name');
    expect(preview.contentEl.children.length).toBeGreaterThan(0);
    await plugin.preview();
    expect(app.workspace.createLeafBySplit).toHaveBeenCalledTimes(1);
    expect(preview.page.text()).toContain('Latest Name');
  });
  it('follows changes in the paired editor, clears deleted notes, and cancels pending work when closed', async () => {
    vi.useFakeTimers();
    const {plugin, editor, view, emit, files, previewLeaves} = host();
    await plugin.onload(); await plugin.preview();
    const preview = previewLeaves[0].view;
    const second = Object.assign(new File(), {path: 'Career/New.md', basename: 'New'});
    files.set(second.path, second);
    view.file = second;
    editor.getValue.mockReturnValue(demoMarkdown.replace('Alex Morgan', 'Second Name'));
    emit('file-open', second);
    await Promise.resolve(); await Promise.resolve();
    expect(preview.page.text()).toContain('Second Name');
    emit('delete', second);
    expect(preview.saveButton.disabled).toBe(true);
    expect(preview.page.children).toHaveLength(0);
    emit('editor-change', editor, view);
    const render = vi.spyOn(plugin, 'snapshot');
    await preview.onClose();
    await vi.advanceTimersByTimeAsync(200);
    expect(render).not.toHaveBeenCalled();
    expect(preview.contentEl.children).toHaveLength(0);
  });
});

describe('page fill lint', () => {
  it('uses printable height and changes from warning to ready at the chosen threshold', () => {
    for (const template of ['classic', 'pepperdine'] as const) {
      const layout = layoutResume(demoMarkdown, template);
      const height = layout.page.height - layout.page.top - layout.page.bottom;
      const withFill = (percent: number) => [{...layout, issues: [], bottom: layout.page.top + height * percent / 100}];
      expect(pageLint(withFill(84.99))).toEqual({state: 'warning', text: 'Warning — less than 85% filled'});
      expect(pageLint(withFill(85)).state).toBe('success');
      expect(pageLint(withFill(100)).state).toBe('success');
      expect(pageLint(withFill(85), 90).text).toBe('Warning — less than 90% filled');
      expect(pageLint([{...layout, overflow: 1}]).text).toBe('Error — more than one page');
      expect(pageLint([layout, layout]).state).toBe('error');
      expect(pageLint([{...layout, issues: [{code: 'glyph', severity: 'error', message: 'Unsupported character'}]}]).state).toBe('error');
    }
    expect(fillThreshold(undefined)).toBe(85);
    expect(fillThreshold(NaN)).toBe(85);
    expect(fillThreshold(120)).toBe(100);
    expect(fillThreshold(-1)).toBe(1);
  });
});

describe('PDF filename details', () => {
  it('keeps names Unicode, omits empty companies, validates dates, and prevents path characters', () => {
    const markdown = demoMarkdown.replace('Alex Morgan', 'Élodie García');
    expect(pdfBasename(markdown, {company: '  ', date: '2026-10-23'})).toBe('Élodie García_2026-10-23');
    expect(pdfBasename(markdown, {company: '../Acme/Research', date: '2026-10-23'})).toBe('Élodie García_..-Acme-Research_2026-10-23');
    expect(() => pdfBasename(markdown, {company: '', date: '2026-02-30'})).toThrow('valid PDF date');
    expect(() => pdfBasename(markdown, {company: '', date: ''})).toThrow('valid PDF date');
    expect(localDate(new Date(2026, 0, 2))).toBe('2026-01-02');
  });
});
