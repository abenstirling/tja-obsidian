declare module 'embedded-resume-fonts' {
  const fonts: [string, string, string, string, string];
  export default fonts;
}

declare module 'embedded-resume-examples' {
  const examples: Record<import('./src/shared/resume-templates').ResumeTemplateId, string>;
  export default examples;
}
