import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {createPDF,type ResumeFonts} from '@tja/resume-core/pdf';
import {layoutResume,RESUME_PAGE} from '@tja/resume-core/layout';
import {demoMarkdown} from './fixtures';
import {PEPPERDINE_PAGE} from '@tja/resume-core/templates';
// Keep regression data independent of editable or retired example notes.
const pepperdine = `# Your Name
City, State · name@example.com · (555) 123-4567

## Education
### Pepperdine Graziadio Business School - Malibu, CA | Expected May 2027
*Master of Business Administration, Finance*
- Honors: Academic distinction and a merit scholarship

## Experience
### Example Company - Los Angeles, CA | June 2024 - August 2026
*Business Analyst*
- Analyzed operational data and presented findings to department leadership.

## Project Work
### Example Client - Graduate Consulting Project | January 2026 - April 2026
- **Digital Marketing:** Developed a proposal with market research and financial analysis.

## Leadership
### Student Organization - Events Coordinator | September 2025 - Present
- Organized four networking events with six volunteers.

## Skills
Excel · Tableau · SQL · English and conversational Spanish
`;
const fonts=['Regular','Bold','Italic'].map(weight=>readFileSync(`public/fonts/LiberationSerif-${weight}.ttf`).toString('base64')) as ResumeFonts;
const header='# Élodie García\n\n## Experience\n### Designer · Example Co\n2022-present\n';
const bullet='- Designed accessible tools and improved the onboarding experience.\n';
describe('one-page resume contract',()=>{
 it('exports a single US Letter page with readable fixed sizes and all selected facts',()=>{
  const text=demoMarkdown.replace('Alex Morgan','Élodie García'),layout=layoutResume(text),pdf=createPDF(text,fonts);
  expect(layout.ok).toBe(true);expect(pdf.getNumberOfPages()).toBe(1);
  expect(pdf.internal.pageSize.getWidth()).toBe(612);expect(pdf.internal.pageSize.getHeight()).toBe(792);
  expect(layout.lines.filter(line=>line.size===10.25).length).toBeGreaterThan(5);
  expect(layout.lines.some(line=>line.text.includes('60 reusable'))).toBe(true);
  expect(layout.lines.every(line=>line.top>=RESUME_PAGE.top&&line.bottom<=756&&line.left>=46.8&&line.right<=565.2)).toBe(true);
 });
 it('rejects overflow rather than adding pages, shrinking or silently dropping the final fact',()=>{
  let count=1;while(layoutResume(header+bullet.repeat(count)).ok)count++;
  const fitting=header+bullet.repeat(count-1),overflow=header+bullet.repeat(count);
  expect(createPDF(fitting,fonts).getNumberOfPages()).toBe(1);
  const bad=layoutResume(overflow);expect(bad.ok).toBe(false);expect(bad.overflow).toBeGreaterThan(0);
  expect(bad.issues.find(issue=>issue.code==='overflow')?.line).toBe(count+5);
  expect(()=>createPDF(overflow,fonts)).toThrow('one-page limit');
  expect(layoutResume(overflow).lines.filter(line=>line.text==='•')).toHaveLength(count);
 });
 it('wraps long unbroken links and keeps right-aligned contact within margins',()=>{
  const layout=layoutResume(`${header}\n## Contact\nhttps://example.com/${'portfolio'.repeat(45)}\n## Skills\n${'Research '.repeat(8)}`);
  expect(layout.ok).toBe(true);expect(layout.lines.filter(line=>line.font==='italic').length).toBeGreaterThan(1);
  expect(layout.lines.every(line=>line.left>=46.8&&line.right<=565.2)).toBe(true);
 });
 it('normalizes accented text and blocks missing glyphs instead of losing them in the PDF',()=>{
  expect(layoutResume(demoMarkdown.replace('Alex Morgan','E\u0301lodie García')).ok).toBe(true);
  expect(()=>createPDF(demoMarkdown+'\n- Achievement 🚀',fonts)).toThrow('cannot render');
 });
 it('requires valid Markdown but leaves underfill advisory',()=>{
  expect(()=>createPDF('Empty',fonts)).toThrow('plain resume Markdown');
  expect(layoutResume(demoMarkdown).issues.some(issue=>issue.code==='underfill')).toBe(true);
  expect(createPDF(demoMarkdown,fonts).getNumberOfPages()).toBe(1);
 });
});
describe('Pepperdine Markdown-to-PDF template',()=>{
 it('matches the reference header, margins, typography, rules, and right-aligned dates',()=>{
  const layout=layoutResume(pepperdine,'pepperdine');
  expect(layout.ok).toBe(true);expect(layout.page).toEqual(PEPPERDINE_PAGE);
  const name=layout.lines.find(line=>line.text==='YOUR NAME')!;
  expect(name.size).toBe(14);expect(name.font).toBe('bold');
  expect(name.x+name.width/2).toBeCloseTo(306,4);
  expect(layout.lines.every(line=>line.color==='#000000')).toBe(true);
  expect(layout.rules[0]).toMatchObject({x:50.4,weight:1.5});
  expect(layout.rules[0].width).toBeCloseTo(511.2,4);
  expect(layout.rules.filter(rule=>rule.weight===.5)).toHaveLength(5);
  expect(layout.lines.some(line=>line.font==='italic'&&line.text.includes('Master of Business'))).toBe(true);
  const date=layout.lines.find(line=>line.text==='Expected May 2027')!;
  expect(date.x+date.width).toBeCloseTo(559.6,4);
  expect(layout.lines.find(line=>line.text.includes('Pepperdine Graziadio'))?.y).toBe(date.y);
  const label=layout.lines.find(line=>line.text.trim()==='Digital Marketing:')!;
  expect(label.font).toBe('bold');
  expect(layout.lines.some(line=>line.font==='normal'&&line.y===label.y&&line.text.includes('Developed'))).toBe(true);
  expect(layout.lines.every(line=>line.left>=50.39&&line.right<=561.61&&line.top>=35.99&&line.bottom<=756.01)).toBe(true);
  expect(createPDF(pepperdine,fonts,'pepperdine').getNumberOfPages()).toBe(1);
 });
 it('uses the requested template for PDF export while keeping Classic available',()=>{
  const source=pepperdine;
  const classic=layoutResume(source),selected=layoutResume(source,'pepperdine');
  expect(classic.template).toBe('classic');expect(selected.template).toBe('pepperdine');
  expect(selected.lines.find(line=>line.size===14)?.font).toBe('bold');
  expect(createPDF(source,fonts,'pepperdine').getFontSize()).toBe(11);
 });
 it('aligns a separate date line and wraps long headings and dates without overlapping text',()=>{
  const layout=layoutResume(demoMarkdown,'pepperdine');
  expect(layout.ok).toBe(true);
  const date=layout.lines.find(line=>line.text==='2022-present')!;
  expect(date.y).toBe(layout.lines.find(line=>line.text.includes('Senior Product Designer'))?.y);
  const longer=pepperdine.replace('Expected May 2027','Expected '+ 'academic program completion '.repeat(10));
  const longLayout=layoutResume(longer,'pepperdine');
  expect(longLayout.lines.every(line=>line.left>=50.39&&line.right<=561.61)).toBe(true);
  expect(longLayout.lines.some(line=>line.text.includes('academic program'))).toBe(true);
 });
 it('blocks overflow and missing glyphs in Pepperdine without losing the final fact',()=>{
  const overflow=pepperdine+'\n'+('- Another truthful achievement.\n'.repeat(70));
  expect(()=>createPDF(overflow,fonts,'pepperdine')).toThrow('one-page limit');
  expect(()=>createPDF(pepperdine+'\n- Achievement 🚀',fonts,'pepperdine')).toThrow('cannot render');
  expect(layoutResume(overflow,'pepperdine').lines.filter(line=>line.text.includes('Another truthful')).length).toBe(70);
 });
});
