import {build} from 'esbuild';
import {readFile, mkdir, copyFile, rm} from 'node:fs/promises';
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
for (const name of ['manifest.json', 'styles.css', 'README.md', 'templates.png', 'Ben Stirling example.md', 'LICENSE']) {
  await copyFile(resolve(here, name), resolve(output, name));
}
await copyFile(resolve(here, 'public/fonts/LiberationSerif-LICENSE.txt'), resolve(output, 'FONT-LICENSE.txt'));
console.log(`Built ${output}`);

await copyFile(resolve(here, 'public/fonts/OFL.txt'), resolve(output, 'SANS-FONT-LICENSE.txt'));
