import {build} from 'esbuild';
import {readFile, mkdir, copyFile, rm, writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve, dirname} from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const output = resolve(here, 'release/resume-pdf');
// Rebuild only this generated directory so retired assets cannot leak into releases.
await rm(output, {recursive: true, force: true});
await mkdir(output, {recursive: true});
await build({
  entryPoints: [resolve(here, 'main.ts')],
  outfile: resolve(output, 'main.js'),
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  external: ['obsidian'],
  minify: true,
  legalComments: 'eof',
  plugins: [{
    name: 'embedded-resume-fonts',
    setup(builder) {
      // Obsidian writes PDF bytes through its vault API. Remove jsPDF's optional
      // popup viewers, including their external script/style injection capability.
      // Use the readable distribution and fail closed if upstream markers change.
      builder.onResolve({filter: /^jspdf$/}, () => ({path: resolve(here, 'node_modules/jspdf/dist/jspdf.es.js'), namespace: 'vault-only-jspdf'}));
      builder.onLoad({filter: /.*/, namespace: 'vault-only-jspdf'}, async args => {
        let source = await readFile(args.path, 'utf8');
        for (const [start, end, replacement] of [
          ['  var clearDomNode =', '  /**\n   * Generates the PDF document.', ''],
          ['      case "pdfobjectnewwindow":', '      case "datauri":', '      case "pdfobjectnewwindow":\n      case "pdfjsnewwindow":\n      case "dataurlnewwindow":\n        throw new Error("Use Obsidian to open exported PDFs.");\n']
        ]) {
          const from = source.indexOf(start), to = source.indexOf(end, from);
          if (from < 0 || to < 0) throw new Error('jsPDF viewer boundaries changed; review the vault-only build.');
          source = source.slice(0, from) + replacement + source.slice(to);
        }
        return {contents: source, loader: 'js', resolveDir: dirname(args.path)};
      });
      // PDF output uses positioned text and rules only. Exclude jsPDF's unused
      // HTML/SVG rasterizers and their DOM/script-loading polyfills entirely.
      builder.onResolve({filter: /^(canvg|html2canvas|dompurify)$/}, args => ({path: args.path, namespace: 'unsupported-rasterizer'}));
      builder.onLoad({filter: /.*/, namespace: 'unsupported-rasterizer'}, () => ({
        contents: `const unsupported = () => { throw new Error('HTML and SVG rasterization are not supported.'); }; export default unsupported; export const Canvg = {fromString: unsupported};`, loader: 'js'
      }));
      builder.onResolve({filter: /^embedded-resume-examples$/}, () => ({path: 'examples', namespace: 'resume-examples'}));
      builder.onLoad({filter: /.*/, namespace: 'resume-examples'}, async () => {
        const markdown = await readFile(resolve(here, 'Ben Stirling example.md'), 'utf8');
        const examples = {classic: markdown, pepperdine: markdown, plumeria: markdown};
        return {contents: `export default ${JSON.stringify(examples)}`, loader: 'js'};
      });
      builder.onResolve({filter: /^embedded-resume-fonts$/}, () => ({path: 'fonts', namespace: 'resume-fonts'}));
      builder.onLoad({filter: /.*/, namespace: 'resume-fonts'}, async () => {
        const fonts = await Promise.all(['LiberationSerif-Regular', 'LiberationSerif-Bold', 'LiberationSerif-Italic', 'NotoSans-Regular', 'NotoSans-Bold'].map(async name =>
          (await readFile(resolve(here, `public/fonts/${name}.ttf`))).toString('base64')));
        return {contents: `export default ${JSON.stringify(fonts)}`, loader: 'js'};
      });
    }
  }]
});
for (const name of ['manifest.json', 'README.md', 'templates.png', 'Ben Stirling example.md', 'LICENSE']) {
  await copyFile(resolve(here, name), resolve(output, name));
}
await copyFile(resolve(here, 'public/fonts/LiberationSerif-LICENSE.txt'), resolve(output, 'FONT-LICENSE.txt'));
console.log(`Built ${output}`);

await copyFile(resolve(here, 'public/fonts/OFL.txt'), resolve(output, 'SANS-FONT-LICENSE.txt'));

// Obsidian loads styles.css itself; no runtime style elements are created.
const fontFaces = await Promise.all(['LiberationSerif-Regular', 'LiberationSerif-Bold', 'LiberationSerif-Italic', 'NotoSans-Regular', 'NotoSans-Bold'].map(async (name, index) => {
  const data = (await readFile(resolve(here, `public/fonts/${name}.ttf`))).toString('base64');
  return `@font-face{font-family:${index < 3 ? 'ResumePDFSerif' : 'ResumePDFSans'};font-style:${index === 2 ? 'italic' : 'normal'};font-weight:${index === 1 || index === 4 ? '700' : '400'};src:url(data:font/ttf;base64,${data}) format('truetype');}`;
}));
await writeFile(resolve(output, 'styles.css'), (await readFile(resolve(here, 'styles.css'), 'utf8')) + '\n' + fontFaces.join('\n') + '\n');
