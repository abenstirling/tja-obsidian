import {markdownBlocks, validateMarkdown} from './markdown';
import {measure, wrap, type ResumeFont} from './resume-font';
import metrics from './plumeria-font-metrics.json';
import type {LintIssue, ResumeLayout, ResumeLine, ResumeRule} from './resume-layout';

const page = {width: 612, height: 792, top: 36, right: 43.2, bottom: 36, left: 43.2};
const ink = '#202b36', muted = '#596775', accent = '#5fa8d3';
const clean = (text: string) => text.normalize('NFC').replace(/\*+/g, '').replace(/[–—‑−]/g, '-').replace(/\u00a0/g, ' ');

/** Asymmetric name/contact masthead and numbered section rail, measured for SVG and PDF. */
export function layoutPlumeria(markdown: string): ResumeLayout {
  const issues: LintIssue[] = [], lines: ResumeLine[] = [], rules: ResumeRule[] = [];
  try { validateMarkdown(markdown); } catch (error) { issues.push({code: 'markdown', severity: 'error', message: (error as Error).message}); }
  const usable = page.width - page.left - page.right;
  const source = markdown.replaceAll('\r', '').split('\n');
  let offset = 0, y = page.top;
  const blocks = markdownBlocks(markdown).map(block => {
    while (offset < source.length && !source[offset].trim()) offset++;
    return {...block, text: clean(block.text), sourceLine: ++offset};
  });
  function run(text: string, x: number, baseline: number, size: number, font: ResumeFont, color: string, sourceLine: number) {
    const m = measure(text, font, size, metrics);
    if ([...text].some(char => !metrics[font][String(char.codePointAt(0)) as keyof typeof metrics.normal]) && !issues.some(issue => issue.code === 'glyph')) {
      issues.push({code: 'glyph', severity: 'error', line: sourceLine, message: 'This template cannot render one or more characters. Replace unsupported symbols before downloading.'});
    }
    lines.push({text, x, y: baseline, size, font, color, width: m.width, sourceLine,
      top: baseline - Math.max(m.ascent, size * .9), bottom: baseline + Math.max(m.descent, size * .23), left: x + m.left, right: x + m.right});
  }
  const firstSection = blocks.findIndex(block => block.kind === 'section');
  const headerBlocks = firstSection < 0 ? blocks : blocks.slice(0, firstSection);
  const bodyBlocks = firstSection < 0 ? [] : blocks.slice(firstSection);
  const bodyX = page.left + 112, bodyWidth = usable - 112;
  const metadataX = page.width - page.right - 153;
  let nameY = page.top + 14, metadataY = page.top + 17;
  rules.push({x: page.left, y: page.top + 3, width: 29, weight: 4, color: accent});
  for (const block of headerBlocks) {
    if (block.kind === 'name') {
      const words = block.text.toUpperCase().split(/\s+/);
      const parts = words.length > 1 ? [words[0], words.slice(1).join(' ')] : words;
      for (const [partIndex, part] of parts.entries()) for (const row of wrap(part, 'bold', 36, metadataX - page.left - 23, metrics)) {
        run(row, page.left, nameY + 39.6, 36, 'bold', partIndex ? accent : ink, block.sourceLine);
        nameY += 43;
      }
    } else {
      for (const row of wrap(block.text, 'normal', 8.5, 150, metrics)) {
        run(row, metadataX, metadataY + 9.35, 8.5, 'normal', muted, block.sourceLine);
        metadataY += 12.6;
      }
      metadataY += 6;
    }
  }
  y = Math.max(nameY, metadataY) + 23;
  rules.push({x: page.left, y, width: usable, weight: 1, color: ink});
  y += 24;
  let sectionNumber = 0, railBottom = y;
  for (const block of bodyBlocks) {
    const section = block.kind === 'section', sub = block.kind === 'subheading', bullet = block.kind === 'bullet';
    if (section) {
      if (sectionNumber) y = Math.max(y, railBottom) + 24;
      sectionNumber++;
      run(String(sectionNumber).padStart(2, '0'), page.left, y + 22, 21, 'normal', accent, block.sourceLine);
      let labelY = y + 33;
      for (const row of wrap(block.text.toUpperCase(), 'bold', 7.5, 93, metrics)) {
        run(row, page.left, labelY + 8.25, 7.5, 'bold', ink, block.sourceLine); labelY += 11;
      }
      railBottom = labelY + 4;
      rules.push({x: bodyX, y: y - 6, width: bodyWidth, weight: .5, color: '#dce3e8'});
      continue;
    }
    if (sub) y += 3;
    const dateOnly = block.kind === 'paragraph' && /^(?:Expected\s+)?(?:[A-Z][a-z]+\s+)?(?:19|20)\d{2}(?:\s*-.*)?$/i.test(block.text);
    const size = dateOnly ? 8 : sub ? 10 : 9.25;
    const font: ResumeFont = sub ? 'bold' : 'normal';
    const color = dateOnly ? muted : ink;
    const split = sub ? block.text.match(/^(.*?)\s+\|\s+(.+)$/) : null;
    const text = split?.[1] || block.text, date = split?.[2];
    const dateWidth = date ? measure(date, 'normal', 8, metrics).width : 0;
    const inlineDate = !!date && dateWidth < bodyWidth * .4;
    const indent = bullet ? 12 : 0;
    const startY = y;
    for (const [index, row] of wrap(text, font, size, bodyWidth - indent - 3 - (inlineDate ? dateWidth + 16 : 0), metrics).entries()) {
      run(row, bodyX + indent, y + size * 1.1, size, font, color, block.sourceLine);
      if (bullet && index === 0) run('•', bodyX + 1, y + size * 1.1, size, 'normal', accent, block.sourceLine);
      y += 12.8;
    }
    if (date) {
      if (inlineDate) run(date, page.width - page.right - dateWidth - 2, startY + size * 1.1, 8, 'normal', muted, block.sourceLine);
      else for (const row of wrap(date, 'normal', 8, bodyWidth - 3, metrics)) { run(row, bodyX, y + 8.8, 8, 'normal', muted, block.sourceLine); y += 11.5; }
    }
    y += sub || dateOnly ? 2 : 4;
  }
  const bottom = Math.max(page.top, ...lines.map(line => line.bottom));
  const overflow = Math.max(0, bottom - (page.height - page.bottom));
  const offending = lines.find(line => line.bottom > page.height - page.bottom + .01 || line.top < page.top - .01 || line.left < page.left - .01 || line.right > page.width - page.right + .01);
  if (offending) issues.push({code: 'overflow', severity: 'error', line: offending.sourceLine, message: overflow ? 'Over the one-page limit.' : 'Text exceeds the page margins.'});
  return {template: 'plumeria', page, lines, rules, issues, ok: !issues.some(issue => issue.severity === 'error'), bottom, overflow};
}
