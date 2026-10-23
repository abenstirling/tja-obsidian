export type PreparedNote = {markdown: string; lineOffset: number};

/** Ignore Obsidian properties, but keep an offset for source-line diagnostics. */
export function prepareNote(source: string): PreparedNote {
  const lines = source.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n');
  let start = 0;
  if (lines[0]?.trimEnd() === '---') {
    const end = lines.findIndex((line, index) => index > 0 && /^(---|\.\.\.)\s*$/.test(line));
    if (end === -1) throw new Error('Close the note properties with a --- line before exporting.');
    start = end + 1;
  }
  while (start < lines.length && !lines[start].trim()) start++;
  const markdown = lines.slice(start).join('\n');
  const unsupported = lines.slice(start).findIndex(line =>
    /!?\[\[|%%|^\s*~~~|^\s*\|/.test(line) || /^\s*(?:\* |\+ |\d+[.)] )/.test(line) || /^\s+[-*+] /.test(line));
  if (unsupported !== -1) {
    throw new Error(`Line ${start + unsupported + 1}: Use plain text and '- ' bullets. Wiki links, embeds, comments, tables and code blocks aren't supported by this resume template.`);
  }
  return {markdown, lineOffset: start};
}

/** All output stays inside the vault and out of its hidden configuration folders. */
export function outputFolder(input: string): string {
  const path = input.trim().replace(/\\/g, '/').replace(/\/+$/, '');
  if (!path) return '';
  if (path.startsWith('/') || path.split('/').some(part => !part || part.startsWith('.') || /[<>:"|?*]/.test(part) || Array.from(part).some(char => char.charCodeAt(0) < 32))) {
    throw new Error('Choose a folder inside the vault, such as Exports/Resumes, without hidden folders or parent paths.');
  }
  return path;
}

export function safeBasename(name: string): string {
  return Array.from(name, char => char.charCodeAt(0) < 32 || /[<>:"/\\|?*]/.test(char) ? '-' : char).join('').replace(/[. ]+$/, '').slice(0, 100) || 'Resume';
}

export const starterResume = `# Your Name

Your professional title
City, State · name@example.com · example.com

## Experience
### Role · Organization
2024-present
- Replace this sample with a specific achievement from your own experience.
- Describe what you did and the result, using accurate numbers when available.

## Education
Degree · University
Graduation year

## Skills
Skill one · Skill two · Skill three
`;

export type ExportDetails = {company: string; date: string};
export function localDate(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
export function pdfBasename(markdown: string, details: ExportDetails): string {
  const match = details.date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match || localDate(new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))) !== details.date) throw new Error('Choose a valid PDF date.');
  const name = markdown.split('\n').find(line => /^#\s+/.test(line))?.replace(/^#\s+/, '').replace(/\*+/g, '').trim();
  const parts = [safeBasename(name || 'Resume')];
  if (details.company.trim()) parts.push(safeBasename(details.company.trim()));
  parts.push(details.date);
  return parts.join('_');
}
