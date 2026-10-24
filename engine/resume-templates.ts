export const RESUME_TEMPLATES = [
  {id: 'classic', label: 'Salt', hasAccent: true},
  {id: 'pepperdine', label: 'Pepper', hasAccent: false},
  {id: 'plumeria', label: 'Plumeria', hasAccent: true}
] as const;
export type ResumeTemplateId = typeof RESUME_TEMPLATES[number]['id'];
export function resumeTemplate(value: unknown): ResumeTemplateId {
  return value === 'pepperdine' || value === 'plumeria' ? value : 'classic';
}
export const PEPPERDINE_PAGE = {width: 612, height: 792, top: 36, right: 50.4, bottom: 36, left: 50.4} as const;
