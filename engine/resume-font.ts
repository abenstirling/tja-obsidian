import fontMetrics from './resume-font-metrics.json';
export type ResumeFont = 'normal' | 'bold' | 'italic';
export const fonts = fontMetrics as Record<ResumeFont, Record<string, number[]>>;
export function measure(text: string, font: ResumeFont, size: number, metrics = fonts) {
  let advance = 0, left = 0, right = 0, top = 0, bottom = 0;
  for (const char of text) {
    const [w, xMin, yMin, xMax, yMax] = metrics[font][char.codePointAt(0)!] || metrics[font][63];
    left = Math.min(left, advance + xMin); right = Math.max(right, advance + xMax);
    top = Math.max(top, yMax); bottom = Math.min(bottom, yMin); advance += w;
  }
  return {width: advance * size / 1000, left: left * size / 1000, right: Math.max(right, advance) * size / 1000, ascent: top * size / 1000, descent: -bottom * size / 1000};
}
export function wrap(text: string, font: ResumeFont, size: number, width: number, metrics = fonts) {
  const lines: string[] = []; let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (line && measure(`${line} ${word}`, font, size, metrics).width > width) { lines.push(line); line = ''; }
    if (measure(word, font, size, metrics).width > width) {
      for (const char of word) {
        if (line && measure(line + char, font, size, metrics).width > width) { lines.push(line); line = ''; }
        line += char;
      }
    } else line += `${line ? ' ' : ''}${word}`;
  }
  if (line) lines.push(line);
  return lines;
}
