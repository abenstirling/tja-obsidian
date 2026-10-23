import type {ResumeLayout} from './src/shared/resume-layout';

export function fillThreshold(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(1, Math.min(100, Math.round(value))) : 85;
}

/** Fill measures the vertical extent of content inside the printable page margins. */
export function pageLint(pages: ResumeLayout[], minimumFill = 85) {
  const layout = pages[0];
  const fill = 100 * Math.max(0, layout.bottom - layout.page.top) / (layout.page.height - layout.page.top - layout.page.bottom);
  if (pages.length > 1 || layout.overflow > .01) return {state: 'error', text: 'Error — more than one page'} as const;
  const error = layout.issues.find(issue => issue.severity === 'error');
  if (error) return {state: 'error', text: `Error — ${error.message}`} as const;
  const threshold = fillThreshold(minimumFill);
  if (fill + 1e-9 < threshold) return {state: 'warning', text: `Warning — less than ${threshold}% filled`} as const;
  return {state: 'success', text: 'Ready — content properly fills page'} as const;
}
