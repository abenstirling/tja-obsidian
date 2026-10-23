import {markdownBlocks, validateMarkdown, type Block} from './markdown';
import {fonts, measure, type ResumeFont} from './resume-font';
import {PEPPERDINE_PAGE as page} from './resume-templates';
import type {LintIssue, ResumeLayout, ResumeLine, ResumeRule} from './resume-layout';

type Span = {text: string; font: ResumeFont};
type SourceBlock = Block & {sourceLine: number};
const normalize = (text: string) => text.normalize('NFC').replace(/[–—‑−]/g, '-').replace(/\u00a0/g, ' ');
const dateLine = /^(?:Expected\s+)?(?:(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+)?(?:19|20)\d{2}(?:\s*-\s*(?:(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+)?(?:(?:19|20)\d{2}|present|current))?$/i;

function spans(text: string, fallback: ResumeFont): Span[] {
  const result: Span[] = []; let index = 0;
  const pattern = /\*\*([^*]+)\*\*|\*([^*]+)\*/g;
  for (const match of text.matchAll(pattern)) {
    if (match.index > index) result.push({text: text.slice(index, match.index), font: fallback});
    result.push({text: match[1] || match[2], font: match[1] ? 'bold' : 'italic'});
    index = match.index + match[0].length;
  }
  if (index < text.length) result.push({text: text.slice(index), font: fallback});
  return result;
}
const spanWidth = (items: Span[], size: number) => items.reduce((width, item) => width + measure(item.text, item.font, size).width, 0);

/** Wrap styled text once; this same measured layout drives SVG and the PDF. */
function wrapSpans(items: Span[], size: number, width: number): Span[][] {
  const rows: Span[][] = []; let row: Span[] = [], used = 0, pendingSpace: ResumeFont | undefined;
  function append(text: string, font: ResumeFont) {
    const last = row.at(-1);
    if (last?.font === font) last.text += text; else row.push({text, font});
    used += measure(text, font, size).width;
  }
  function flush() { if (row.length) rows.push(row); row = []; used = 0; pendingSpace = undefined; }
  // Preserve style boundaries inside a word so punctuation never gains a space.
  const words: Span[][] = []; let word: Span[] = [];
  for (const span of items) for (const token of span.text.split(/(\s+)/).filter(Boolean)) {
    if (/^\s+$/.test(token)) { if (word.length) { words.push(word); word = []; } }
    else word.push({text: token, font: span.font});
  }
  if (word.length) words.push(word);
  for (const parts of words) {
    const wordWidth = spanWidth(parts, size);
    const gapFont = pendingSpace || parts[0].font;
    const gap = row.length ? measure(' ', gapFont, size).width : 0;
    if (row.length && used + gap + wordWidth > width) flush();
    if (row.length) append(' ', gapFont);
    if (wordWidth <= width) for (const part of parts) append(part.text, part.font);
    else for (const part of parts) for (const char of part.text) {
      if (row.length && used + measure(char, part.font, size).width > width) flush();
      append(char, part.font);
    }
    pendingSpace = parts.at(-1)!.font;
  }
  flush(); return rows;
}

export function layoutPepperdine(markdown: string): ResumeLayout {
  const issues: LintIssue[] = [], lines: ResumeLine[] = [], rules: ResumeRule[] = [];
  try { validateMarkdown(markdown); } catch (error) { issues.push({code: 'markdown', severity: 'error', message: (error as Error).message}); }
  const raw = markdown.replaceAll('\r', '').split('\n'); let offset = 0;
  const blocks: SourceBlock[] = markdownBlocks(markdown).map(block => {
    while (offset < raw.length && !raw[offset].trim()) offset++;
    return {...block, text: normalize(block.text), sourceLine: ++offset};
  });
  const header: SourceBlock[] = [], body: SourceBlock[] = []; let beforeSection = true, contact = false;
  for (const block of blocks) {
    if (block.kind === 'section') { beforeSection = false; contact = block.text.toLowerCase() === 'contact'; if (contact) continue; }
    if (beforeSection || contact) header.push(block); else body.push(block);
  }
  const usable = page.width - page.left - page.right, size = 11, leading = 12.65;
  let y: number = page.top;
  function addRun(span: Span, x: number, baseline: number, pointSize: number, sourceLine: number) {
    const m = measure(span.text, span.font, pointSize);
    for (const char of span.text) if (!fonts[span.font][char.codePointAt(0)!]) {
      if (!issues.some(issue => issue.code === 'glyph')) issues.push({code: 'glyph', severity: 'error', line: sourceLine, message: 'This template cannot render one or more characters. Replace unsupported symbols before downloading.'});
      break;
    }
    lines.push({text: span.text, x, y: baseline, size: pointSize, font: span.font, color: '#000000', width: m.width, sourceLine,
      top: baseline - Math.max(m.ascent, pointSize * .9), bottom: baseline + Math.max(m.descent, pointSize * .23), left: x + m.left, right: x + m.right});
  }
  function addRows(items: Span[], block: SourceBlock, width: number, x: number, pointSize = size, center = false) {
    const rows = wrapSpans(items, pointSize, width);
    const baselines: number[] = [];
    for (const row of rows) {
      const baseline = y + pointSize * .96;
      let cursor = center ? (page.width - spanWidth(row, pointSize)) / 2 : x;
      // Italic glyphs can extend slightly before their advance origin.
      cursor = Math.max(cursor, page.left - measure(row[0].text, row[0].font, pointSize).left);
      baselines.push(baseline);
      for (const span of row) { addRun(span, cursor, baseline, pointSize, block.sourceLine); cursor += measure(span.text, span.font, pointSize).width; }
      y += pointSize === 14 ? 17.8 : leading;
    }
    return baselines;
  }
  for (const block of header) {
    const name = block.kind === 'name';
    addRows(spans(name ? block.text.toUpperCase() : block.text, name ? 'bold' : 'normal'), block, usable - 2, page.left, name ? 14 : size, true);
    if (name) rules.push({x: page.left, y: y - 1, width: usable, weight: 1.5, color: '#000000'});
  }
  for (let index = 0; index < body.length; index++) {
    const block = body[index], section = block.kind === 'section', sub = block.kind === 'subheading', bullet = block.kind === 'bullet';
    if (section) {
      y += leading;
      addRows(spans(block.text.toUpperCase(), 'bold'), block, usable - 2, page.left);
      rules.push({x: page.left, y: y - .3, width: usable, weight: .5, color: '#555555'});
      continue;
    }
    if (sub && index && body[index - 1].kind !== 'section') y += leading * .6;
    const dateSplit = (sub || /^\*[^*]+\*\s+\|/.test(block.text)) ? block.text.match(/^(.*?)\s+\|\s+(.+)$/) : null;
    let text = dateSplit ? dateSplit[1] : block.text;
    let date = dateSplit?.[2]; let dateSource = block.sourceLine;
    const next = body[index + 1];
    if (sub && !date && next?.kind === 'paragraph' && dateLine.test(next.text.trim())) {
      date = next.text.trim(); dateSource = next.sourceLine; index++;
    }
    // A company/institution heading can bold its name and leave the location plain.
    if (sub && !text.includes('*')) {
      const split = text.indexOf(' - ');
      text = split > 0 ? `**${text.slice(0, split)}**${text.slice(split)}` : `**${text}**`;
    }
    const items = spans(text, 'normal');
    const indent = bullet ? 36 : 0;
    const dateItems = date ? spans(date, 'normal') : [];
    const rightWidth = spanWidth(dateItems, size);
    const rowWidth = usable - indent - 2;
    const inlineDate = !!date && rightWidth + 18 < rowWidth;
    const firstY = y;
    const baselines = addRows(items, block, inlineDate ? rowWidth - rightWidth - 18 : rowWidth, page.left + indent);
    if (bullet && baselines.length) addRun({text: '•', font: 'normal'}, page.left + 18, baselines[0], size, block.sourceLine);
    if (date) {
      if (inlineDate) {
        let cursor = page.width - page.right - rightWidth - 2;
        for (const span of dateItems) { addRun(span, cursor, firstY + size * .96, size, dateSource); cursor += measure(span.text, span.font, size).width; }
      } else {
        // Very long dates get their own wrapped rows, never overlap or disappear.
        addRows(dateItems, {...block, sourceLine: dateSource}, usable - 2, page.left);
      }
    }
  }
  const bottom = Math.max(page.top, ...lines.map(line => line.bottom)), limit = page.height - page.bottom, overflow = Math.max(0, bottom - limit);
  const offending = lines.find(line => line.bottom > limit + .01 || line.top < page.top - .01 || line.left < page.left - .01 || line.right > page.width - page.right + .01);
  if (offending) issues.push({code: 'overflow', severity: 'error', line: offending.sourceLine, message: overflow > 0 ? `Over the one-page limit by ${Math.ceil(overflow / leading)} lines with the required 0.5-inch bottom margin. Shorten or remove details before downloading.` : 'Text exceeds the page margins. Shorten this line before downloading.'});
  if (bottom < 690 && !offending) issues.push({code: 'underfill', severity: 'warning', message: 'There is room for more relevant experience, if you have it.'});
  return {template: 'pepperdine', page, lines, rules, issues, ok: !issues.some(issue => issue.severity === 'error'), bottom, overflow};
}
