import {App, ItemView, MarkdownView, Notice, Plugin, PluginSettingTab, Setting, TFile, TFolder, normalizePath, type WorkspaceLeaf, type ViewStateResult} from 'obsidian';
import fonts from 'embedded-resume-fonts';
import examples from 'embedded-resume-examples';
import {createPDF} from './src/pdf';
import {type ResumeLayout} from './src/shared/resume-layout';
import {resumePages, resumeAccent, DEFAULT_ACCENT} from './src/shared/resume-pagination';
import {RESUME_TEMPLATES, resumeTemplate, type ResumeTemplateId} from './src/shared/resume-templates';
import {fillThreshold, pageLint} from './lint';
import {outputFolder, prepareNote, pdfBasename, localDate, type ExportDetails, type PreparedNote} from './note';

type Settings = {minimumFill: number; folder: string; openAfterExport: boolean; template: ResumeTemplateId; accentColor: string};
type Snapshot = PreparedNote & {file: TFile; layout: ResumeLayout; pages: ResumeLayout[]; accentColor: string};
const defaults: Settings = {minimumFill: 85, folder: '', openAfterExport: true, template: 'classic', accentColor: DEFAULT_ACCENT};
const PREVIEW_TYPE = 'the-jobs-application-preview';

export default class ResumePDF extends Plugin {
  settings: Settings = {...defaults};
  private exportFields = new Map<string, ExportDetails>();
  private exporting = false;
  private opening = false;
  private lastSource: TFile | null = null;
  private actions = new Map<MarkdownView, HTMLElement>();

  async onload() {
    const stored = await this.loadData();
    this.settings = {
      minimumFill: fillThreshold(stored?.minimumFill),
      folder: typeof stored?.folder === 'string' ? stored.folder : defaults.folder,
      template: resumeTemplate(stored?.template),
      accentColor: resumeAccent(stored?.accentColor),
      openAfterExport: typeof stored?.openAfterExport === 'boolean' ? stored.openAfterExport : defaults.openAfterExport
    };
    this.addSettingTab(new ResumeSettings(this.app, this));
    this.registerView(PREVIEW_TYPE, leaf => new ResumePreview(leaf, this));
    this.addCommand({
      id: 'preview', name: 'Open live preview beside Markdown',
      checkCallback: checking => {
        const available = this.app.workspace.getActiveFile()?.extension === 'md' || !!this.lastSource;
        if (available && !checking) void this.preview();
        return available;
      }
    });
    this.addCommand({
      id: 'export', name: 'Export current note to PDF',
      checkCallback: checking => {
        const available = this.app.workspace.getActiveFile()?.extension === 'md';
        if (available && !checking) void this.exportCurrent();
        return available;
      }
    });
    this.addCommand({id: 'starter', name: 'New resume from selected template', callback: () => this.createStarter()});
    this.addRibbonIcon('panels-left-right', 'The Jobs Application', () => void this.preview());
    this.app.workspace.onLayoutReady(() => {
      this.updateEditorButtons();
      this.registerEvent(this.app.workspace.on('layout-change', () => this.updateEditorButtons()));
    });
    this.registerEvent(this.app.workspace.on('file-menu', (menu, file) => {
      if (file instanceof TFile && file.extension === 'md') {
        menu.addItem(item => item.setTitle('The Jobs Application: Live preview').setIcon('panels-left-right').onClick(() => void this.preview(file)));
      }
    }));
  }

  onunload() {
    this.app.workspace.detachLeavesOfType(PREVIEW_TYPE);
    for (const button of this.actions.values()) button.remove();
    this.actions.clear();
  }

  private updateEditorButtons() {
    const views = new Set(this.app.workspace.getLeavesOfType('markdown').map(leaf => leaf.view).filter((view): view is MarkdownView => view instanceof MarkdownView));
    for (const [view, button] of this.actions) if (!views.has(view)) { button.remove(); this.actions.delete(view); }
    for (const view of views) {
      if (this.actions.has(view)) continue;
      const button = view.addAction('panels-left-right', 'The Jobs Application', () => void this.preview(view.file || undefined));
      button.addClass('tja-editor-button');
      button.createSpan({text: 'The Jobs Application'});
      this.actions.set(view, button);
    }
  }

  private report(error: unknown) {
    new Notice(`The Jobs Application: ${error instanceof Error ? error.message : String(error)}`, 9000);
  }

  /** Read the editor buffer so recent unsaved edits appear in the PDF too. */
  async snapshot(file = this.app.workspace.getActiveFile(), source?: string, sourceLeaf?: WorkspaceLeaf): Promise<Snapshot> {
    if (!file || file.extension !== 'md') throw new Error('Open a Markdown resume note first.');
    const active = this.app.workspace.getActiveViewOfType(MarkdownView);
    const view = sourceLeaf?.view instanceof MarkdownView ? sourceLeaf.view : active;
    const text = source ?? (view?.file?.path === file.path ? view.editor.getValue() : await this.app.vault.read(file));
    const prepared = prepareNote(text);
    const pages = resumePages(prepared.markdown, this.settings.template, true, this.settings.accentColor);
    return {...prepared, file, layout: pages[0], pages, accentColor: this.settings.accentColor};
  }

  async preview(file?: TFile) {
    if (this.opening) return;
    this.opening = true;
    try {
      const source = file || this.app.workspace.getActiveFile() || this.lastSource;
      if (!source || source.extension !== 'md') throw new Error('Open a Markdown resume note first.');
      this.lastSource = source;
      const active = this.app.workspace.getActiveViewOfType(MarkdownView);
      let sourceLeaf = active?.file?.path === source.path ? active.leaf : this.app.workspace.getLeavesOfType('markdown').find(leaf => (leaf.view as MarkdownView).file?.path === source.path);
      if (!sourceLeaf) {
        sourceLeaf = this.app.workspace.getLeaf('tab');
        await sourceLeaf.openFile(source);
      }
      const previewLeaf = this.app.workspace.getLeavesOfType(PREVIEW_TYPE)[0] || this.app.workspace.createLeafBySplit(sourceLeaf, 'vertical');
      await previewLeaf.setViewState({type: PREVIEW_TYPE, state: {sourcePath: source.path}, active: false});
      if (previewLeaf.view instanceof ResumePreview) await previewLeaf.view.bindSource(source, sourceLeaf);
      this.app.workspace.setActiveLeaf(sourceLeaf, {focus: true});
    } catch (error) { this.report(error); }
    finally { this.opening = false; }
  }

  exportDetails(file: TFile): ExportDetails {
    let details = this.exportFields.get(file.path);
    if (!details) { details = {company: '', date: localDate()}; this.exportFields.set(file.path, details); }
    details.date = localDate();
    return details;
  }

  async exportCurrent() {
    try { await this.exportSnapshot(await this.snapshot()); }
    catch (error) { this.report(error); }
  }

  /** Used by preview: export exactly what was previewed, even if the editor changes. */
  async exportSnapshot(snapshot: Snapshot): Promise<boolean> {
    if (this.exporting) return false;
    this.exporting = true;
    let created: TFile | undefined;
    try {
      const issue = snapshot.layout.issues.find(item => item.severity === 'error');
      if (issue?.code === 'overflow' && snapshot.layout.overflow > 0) throw new Error('You are beyond the one-page limit and text is not showing.');
      if (issue) throw new Error(`${issue.line ? `Line ${issue.line + snapshot.lineOffset}: ` : ''}${issue.message}`);
      const filename = pdfBasename(snapshot.markdown, this.exportDetails(snapshot.file));
      const bytes = createPDF(snapshot.markdown, fonts, snapshot.layout.template, true, snapshot.accentColor).output('arraybuffer');
      const chosen = outputFolder(this.settings.folder);
      const parent = snapshot.file.parent?.path;
      const folder = chosen || (parent === '/' ? '' : parent || '');
      await this.ensureFolder(folder);
      const base = normalizePath([folder, filename].filter(Boolean).join('/'));
      created = await this.app.vault.createBinary(this.unusedPath(base, 'pdf'), bytes);
      new Notice(`Saved ${created.path}`);
    } catch (error) { this.report(error); }
    finally { this.exporting = false; }
    if (!created) return false;
    if (this.settings.openAfterExport) {
      try { await this.app.workspace.getLeaf('tab').openFile(created); }
      catch { new Notice(`PDF saved at ${created.path}, but the viewer could not open it.`); }
    }
    return true;
  }

  private unusedPath(base: string, extension: string): string {
    let path = `${base}.${extension}`;
    for (let index = 2; this.app.vault.getAbstractFileByPath(path); index++) path = `${base} (${index}).${extension}`;
    return path;
  }

  private async ensureFolder(path: string) {
    if (!path || path === '/') return;
    let current = '';
    for (const part of path.split('/')) {
      current = current ? `${current}/${part}` : part;
      const existing = this.app.vault.getAbstractFileByPath(current);
      if (existing && !(existing instanceof TFolder)) throw new Error(`A file already exists at ${current}. Choose another export folder.`);
      if (!existing) await this.app.vault.createFolder(current);
    }
  }

  async createStarter(openPreview = false) {
    try {
      const folder = this.app.workspace.getActiveFile()?.parent?.path;
      const parent = folder === '/' ? '' : folder || '';
      const label = RESUME_TEMPLATES.find(template => template.id === this.settings.template)!.label;
      const base = normalizePath([parent, `Resume - ${label}`].filter(Boolean).join('/'));
      const file = await this.app.vault.create(this.unusedPath(base, 'md'), examples[this.settings.template]);
      await this.app.workspace.getLeaf('tab').openFile(file);
      if (openPreview) await this.preview(file);
    } catch (error) { this.report(error); }
  }
}

class ResumePreview extends ItemView {
  private sourcePath = '';
  private sourceLeaf?: WorkspaceLeaf;
  private current?: Snapshot;
  private timer?: ReturnType<typeof setTimeout>;
  private revision = 0;
  private closed = false;
  private ready = false;
  private companyInput!: HTMLInputElement;
  private filenameLabel!: HTMLElement;
  private saveButton!: HTMLButtonElement;
  private colorLabel!: HTMLElement;
  private colorPicker!: HTMLInputElement;
  private templateSelect!: HTMLSelectElement;
  private subtitle!: HTMLElement;
  private status!: HTMLElement;
  private page!: HTMLElement;

  constructor(leaf: WorkspaceLeaf, private plugin: ResumePDF) { super(leaf); }
  getViewType() { return PREVIEW_TYPE; }
  getDisplayText() { return 'The Jobs Application'; }
  getIcon() { return 'panels-left-right'; }
  getState() { return {sourcePath: this.sourcePath}; }

  async setState(state: {sourcePath?: string}, result: ViewStateResult) {
    this.sourcePath = typeof state.sourcePath === 'string' ? state.sourcePath : '';
    await super.setState(state, result);
    if (this.ready) await this.refresh();
  }

  async bindSource(file: TFile, leaf: WorkspaceLeaf) {
    this.sourcePath = file.path;
    this.sourceLeaf = leaf;
    await this.refresh();
  }

  async onOpen() {
    this.closed = false;
    this.contentEl.empty();
    this.contentEl.addClass('tja-preview');
    const toolbar = this.contentEl.createDiv({cls: 'tja-preview-toolbar'});
    const heading = toolbar.createDiv();
    heading.createEl('h3', {text: 'The Jobs Application'});
    this.subtitle = heading.createEl('p', {cls: 'resume-pdf-subtitle'});
    const controls = toolbar.createDiv({cls: 'tja-preview-controls'});
    const label = controls.createEl('label', {cls: 'tja-template-picker'});
    label.createSpan({text: 'Template'});
    this.templateSelect = label.createEl('select', {attr: {'aria-label': 'Resume template'}});
    for (const template of RESUME_TEMPLATES) this.templateSelect.createEl('option', {value: template.id, text: template.label});
    this.templateSelect.value = this.plugin.settings.template;
    this.registerDomEvent(this.templateSelect, 'change', () => {
      this.plugin.settings.template = resumeTemplate(this.templateSelect.value);
      this.updateAccentVisibility(this.plugin.settings.template);
      this.invalidate();
      void this.refresh();
      void this.plugin.saveData(this.plugin.settings).catch(() => new Notice('The template changed, but the preference could not be saved.'));
    });
    const colorLabel = this.colorLabel = controls.createEl('label', {cls: 'tja-template-picker'});
    this.updateAccentVisibility(this.plugin.settings.template);
    colorLabel.createSpan({text: 'Accent'});
    this.colorPicker = colorLabel.createEl('input', {type: 'color', value: this.plugin.settings.accentColor, attr: {'aria-label': 'Heading accent color', title: 'Choose the template accent color'}});
    this.registerDomEvent(this.colorPicker, 'input', () => {
      this.plugin.settings.accentColor = resumeAccent(this.colorPicker.value);
      this.invalidate();
      void this.refresh();
    });
    this.registerDomEvent(this.colorPicker, 'change', () => {
      this.plugin.settings.accentColor = resumeAccent(this.colorPicker.value);
      this.invalidate();
      void this.refresh();
      void this.plugin.saveData(this.plugin.settings).catch(() => new Notice('The color could not be saved.'));
    });
    const newButton = controls.createEl('button', {text: 'New resume', attr: {title: 'Create an editable Markdown note using this template'}});
    this.registerDomEvent(newButton, 'click', () => { void this.plugin.createStarter(true); });
    const exportFields = toolbar.createDiv({cls: 'tja-export-fields'});
    const companyLabel = exportFields.createEl('label');
    companyLabel.createSpan({text: 'Company'});
    this.companyInput = companyLabel.createEl('input', {type: 'text', placeholder: 'Optional', attr: {'aria-label': 'Company for PDF filename', maxlength: '100'}});
    this.filenameLabel = exportFields.createEl('p', {cls: 'resume-pdf-subtitle tja-export-filename', attr: {'aria-live': 'polite'}});
    const updateExportFields = () => {
      if (!this.current) return;
      const details = this.plugin.exportDetails(this.current.file);
      details.company = this.companyInput.value;
      this.updateFilename();
    };
    this.registerDomEvent(this.companyInput, 'input', updateExportFields);
    this.registerDomEvent(this.companyInput, 'change', updateExportFields);
    this.saveButton = controls.createEl('button', {text: 'Save PDF', cls: 'mod-cta'});
    this.saveButton.disabled = true;
    this.registerDomEvent(this.saveButton, 'click', () => {
      const snapshot = this.current;
      if (!snapshot || !snapshot.layout.ok) return;
      this.saveButton.disabled = true;
      void this.plugin.exportSnapshot(snapshot).finally(() => {
        if (!this.closed) this.saveButton.disabled = !this.current?.layout.ok;
      });
    });
    const scroll = this.contentEl.createDiv({cls: 'tja-preview-scroll'});
    this.status = scroll.createDiv({cls: 'resume-pdf-status', attr: {'aria-live': 'polite'}});
    // Fonts mount once; keystrokes only redraw the page and its status.
    const css = fonts.map((data, index) => `@font-face{font-family:${index < 3 ? 'ResumePDFSerif' : 'ResumePDFSans'};font-style:${index === 2 ? 'italic' : 'normal'};font-weight:${index === 1 || index === 4 ? '700' : '400'};src:url(data:font/ttf;base64,${data}) format('truetype');}`).join('\n');
    this.contentEl.createEl('style', {text: css});
    this.page = scroll.createDiv({cls: 'resume-pdf-page'});
    this.ready = true;
    this.registerEvent(this.app.workspace.on('editor-change', (editor, info) => {
      if (info.file?.path !== this.sourcePath) return;
      if (this.sourceLeaf && info instanceof MarkdownView && info.leaf !== this.sourceLeaf) return;
      this.schedule(editor.getValue());
    }));
    this.registerEvent(this.app.workspace.on('file-open', () => {
      const view = this.sourceLeaf?.view;
      if (view instanceof MarkdownView && view.file) {
        this.sourcePath = view.file.path;
        void this.refresh();
      }
    }));
    this.registerEvent(this.app.vault.on('modify', file => {
      if (file.path === this.sourcePath) this.schedule();
    }));
    this.registerEvent(this.app.vault.on('rename', (file, oldPath) => {
      if (oldPath === this.sourcePath) { this.sourcePath = file.path; void this.refresh(); }
    }));
    this.registerEvent(this.app.vault.on('delete', file => {
      if (file.path === this.sourcePath) {
        this.invalidate();
        this.showError('The source note was deleted. Open another note and click The Jobs Application.');
      }
    }));
    await this.refresh();
  }

  /** Invalidate immediately, so Save never exports a page from before the latest edit. */
  private invalidate() {
    this.revision++;
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
    this.current = undefined;
    if (this.ready) this.saveButton.disabled = true;
  }

  private schedule(source?: string) {
    this.invalidate();
    this.status.empty();
    this.status.createEl('p', {text: 'Updating preview…', cls: 'resume-pdf-subtitle'});
    this.timer = setTimeout(() => { this.timer = undefined; void this.refresh(source); }, 120);
  }

  private async refresh(source?: string) {
    if (!this.ready || this.closed) return;
    this.invalidate();
    const revision = this.revision;
    try {
      const file = this.app.vault.getAbstractFileByPath(this.sourcePath);
      if (!(file instanceof TFile) || file.extension !== 'md') throw new Error('Open a Markdown resume and click The Jobs Application to start a live preview.');
      const editors = this.app.workspace.getLeavesOfType('markdown');
      if (!this.sourceLeaf || !editors.includes(this.sourceLeaf)) {
        this.sourceLeaf = editors.find(leaf => (leaf.view as MarkdownView).file?.path === file.path);
      }
      const snapshot = await this.plugin.snapshot(file, source, this.sourceLeaf);
      if (revision !== this.revision || this.closed) return;
      this.current = snapshot;
      const details = this.plugin.exportDetails(snapshot.file);
      this.companyInput.value = details.company;
      this.updateFilename();
      this.templateSelect.value = snapshot.layout.template;
      this.updateAccentVisibility(snapshot.layout.template);
      this.colorPicker.value = snapshot.accentColor;
      this.subtitle.setText(`Live preview · ${snapshot.file.basename} · US Letter`);
      this.status.empty();
      const lint = pageLint(snapshot.pages, this.plugin.settings.minimumFill);
      this.status.createEl('p', {text: lint.text, cls: `resume-pdf-${lint.state}`});
      this.saveButton.disabled = !snapshot.layout.ok;
      this.page.empty();
      for (const page of snapshot.pages) this.drawPage(page);
      this.page.toggleClass('resume-pdf-multipage', snapshot.pages.length > 1);
    } catch (error) {
      if (revision !== this.revision || this.closed) return;
      this.showError(error instanceof Error ? error.message : String(error));
    }
  }

  private updateFilename() {
    if (!this.current) { this.filenameLabel.setText(''); return; }
    try { this.filenameLabel.setText(pdfBasename(this.current.markdown, this.plugin.exportDetails(this.current.file)) + '.pdf'); }
    catch (error) { this.filenameLabel.setText(error instanceof Error ? error.message : String(error)); }
  }

  private updateAccentVisibility(template: ResumeTemplateId) {
    this.colorLabel.hidden = !RESUME_TEMPLATES.find(item => item.id === template)?.hasAccent;
  }

  async refreshPreferences() { this.invalidate(); await this.refresh(); }

  private showError(message: string) {
    this.current = undefined;
    this.saveButton.disabled = true;
    this.filenameLabel.setText('');
    this.subtitle.setText('Live preview · Waiting for valid Markdown');
    this.status.empty();
    this.status.createEl('p', {text: message, cls: 'resume-pdf-error'});
    this.page.empty();
  }

  private drawPage(layout: ResumeLayout) {
    const doc = this.contentEl.ownerDocument;
    const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', `0 0 ${layout.page.width} ${layout.page.height}`);
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'Live one-page resume preview');
    this.page.appendChild(svg);
    const title = doc.createElementNS(svg.namespaceURI, 'title');
    title.textContent = 'The Jobs Application: Live preview';
    svg.appendChild(title);
    // Keep the reserved bottom margin empty even while an overflowing draft is shown.
    const clipId = `tja-page-content-${this.page.children.length}`;
    const defs = doc.createElementNS(svg.namespaceURI, 'defs');
    const clip = doc.createElementNS(svg.namespaceURI, 'clipPath');
    clip.setAttribute('id', clipId);
    const bounds = doc.createElementNS(svg.namespaceURI, 'rect');
    for (const [key, value] of Object.entries({x: 0, y: 0, width: layout.page.width, height: layout.page.height - layout.page.bottom})) bounds.setAttribute(key, String(value));
    clip.appendChild(bounds); defs.appendChild(clip); svg.appendChild(defs);
    const content = doc.createElementNS(svg.namespaceURI, 'g');
    content.setAttribute('clip-path', `url(#${clipId})`);
    svg.appendChild(content);
    for (const rule of layout.rules) {
      const line = doc.createElementNS(svg.namespaceURI, 'line');
      for (const [key, value] of Object.entries({x1: rule.x, y1: rule.y, x2: rule.x + rule.width, y2: rule.y, stroke: rule.color || '#3a3a3a', 'stroke-width': rule.weight || 1.2})) line.setAttribute(key, String(value));
      content.appendChild(line);
    }
    for (const line of layout.lines) {
      const text = doc.createElementNS(svg.namespaceURI, 'text');
      text.setAttribute('textLength', String(line.width));
      text.setAttribute('lengthAdjust', 'spacingAndGlyphs');
      text.setAttribute('style', 'white-space: pre');
      for (const [key, value] of Object.entries({x: line.x, y: line.y, 'font-family': layout.template === 'plumeria' ? 'ResumePDFSans' : 'ResumePDFSerif', 'font-size': line.size, 'font-weight': line.font === 'bold' ? 700 : 400, 'font-style': line.font === 'italic' ? 'italic' : 'normal', fill: line.color})) text.setAttribute(key, String(value));
      text.textContent = line.text;
      content.appendChild(text);
    }
  }

  async onClose() {
    this.closed = true;
    this.invalidate();
    this.ready = false;
    this.contentEl.empty();
  }
}

class ResumeSettings extends PluginSettingTab {
  constructor(app: App, private plugin: ResumePDF) { super(app, plugin); }
  display() {
    this.containerEl.empty();
    this.containerEl.createEl('h2', {text: 'The Jobs Application'});
    this.containerEl.createEl('p', {text: 'The same resume layout as The Jobs Application. Fonts are bundled and export works offline.'});
    new Setting(this.containerEl).setName('Export folder').setDesc('A folder relative to the vault root. Leave blank to save beside each source note.').addText(text => {
      text.setPlaceholder('Exports/Resumes').setValue(this.plugin.settings.folder);
      text.inputEl.addEventListener('change', () => {
        void (async () => {
          try {
            const folder = outputFolder(text.getValue());
            this.plugin.settings.folder = folder;
            await this.plugin.saveData(this.plugin.settings);
            text.setValue(folder);
          } catch (error) {
            new Notice(error instanceof Error ? error.message : String(error));
            text.setValue(this.plugin.settings.folder);
          }
        })();
      });
    });
    new Setting(this.containerEl).setName('Minimum page fill').setDesc('Warn when content fills less than this percentage of the printable page height.').addSlider(slider => slider
      .setLimits(1, 100, 1)
      .setValue(this.plugin.settings.minimumFill)
      .setDynamicTooltip()
      .onChange(async value => {
        this.plugin.settings.minimumFill = fillThreshold(value);
        await this.plugin.saveData(this.plugin.settings);
        for (const leaf of this.app.workspace.getLeavesOfType(PREVIEW_TYPE)) if (leaf.view instanceof ResumePreview) await leaf.view.refreshPreferences();
      }));
    new Setting(this.containerEl).setName('Open PDF after export').setDesc('Open the saved PDF in a new Obsidian tab.').addToggle(toggle => toggle.setValue(this.plugin.settings.openAfterExport).onChange(async value => {
      this.plugin.settings.openAfterExport = value;
      await this.plugin.saveData(this.plugin.settings);
    }));
    this.containerEl.createEl('p', {text: 'Format: # Name, ## Section, ### Role, plain paragraphs, and - bullets. Properties are ignored. Tables, images, links, embeds and code blocks are not supported. PDFs stay at the original font size; shorten the note if it exceeds one page.'});
  }
}
