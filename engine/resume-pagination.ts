import {layoutResume, type ResumeLayout} from './resume-layout';
import type {ResumeTemplateId} from './resume-templates';

export const DEFAULT_ACCENT = '#5fa8d3';
export function resumeAccent(value: unknown): string {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : DEFAULT_ACCENT;
}

/** Preserve measured glyph positions and font sizes while moving lines onto Letter pages. */
export function resumePages(markdown: string, template: ResumeTemplateId = 'classic', enforceOnePage = true, accentColor = DEFAULT_ACCENT): ResumeLayout[] {
  const layout = layoutResume(markdown, template);
  const accent = resumeAccent(accentColor);
  layout.lines = layout.lines.map(line => line.color === DEFAULT_ACCENT ? {...line, color: accent} : line);
  layout.rules = layout.rules.map(rule => rule.color === DEFAULT_ACCENT ? {...rule, color: accent} : rule);
  if (enforceOnePage) return [layout];
  const {page} = layout;
  const issues = layout.issues.filter(issue => issue.code !== 'overflow');
  if (layout.overflow > .01) issues.push({code: 'overflow', severity: 'warning',
    line: layout.lines.find(line => line.bottom > page.height - page.bottom + .01)?.sourceLine,
    message: 'You are beyond the one-page limit.'});
  const outside = layout.lines.find(line => line.left < page.left - .01 || line.right > page.width - page.right + .01 || line.top < page.top - .01);
  if (outside) issues.push({code: 'overflow', severity: 'error', line: outside.sourceLine, message: 'Text exceeds the page margins. Shorten this line before downloading.'});
  const pages: ResumeLayout[] = [];
  let offset = 0;
  const fresh = (): ResumeLayout => ({...layout, lines: [], rules: [], issues, ok: !issues.some(issue => issue.severity === 'error'), bottom: page.top, overflow: 0});
  let current = fresh();
  pages.push(current);
  // Lines with the same baseline (including right-aligned dates) stay together.
  const groups = new Map<number, typeof layout.lines>();
  for (const line of layout.lines) groups.set(line.y, [...groups.get(line.y) || [], line]);
  const ranges: {start: number; offset: number; layout: ResumeLayout}[] = [{start: -Infinity, offset: 0, layout: current}];
  for (const [y, lines] of [...groups].sort((a, b) => a[0] - b[0])) {
    const top = Math.min(...lines.map(line => line.top));
    const bottom = Math.max(...lines.map(line => line.bottom));
    if (bottom - offset > page.height - page.bottom + .01 && current.lines.length) {
      offset = top - page.top;
      current = fresh(); pages.push(current);
      ranges.push({start: top, offset, layout: current});
    }
    for (const line of lines) current.lines.push({...line, y: y - offset, top: line.top - offset, bottom: line.bottom - offset});
    current.bottom = Math.max(current.bottom, bottom - offset);
  }
  for (const rule of layout.rules) {
    const range = [...ranges].reverse().find(range => rule.y >= range.start) || ranges[0];
    range.layout.rules.push({...rule, y: rule.y - range.offset});
  }
  return pages;
}
