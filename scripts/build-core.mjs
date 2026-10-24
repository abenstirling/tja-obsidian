import {build} from 'esbuild';
import {readdir, rm} from 'node:fs/promises';

await rm('lib', {recursive: true, force: true});
const entries = (await readdir('engine')).filter(name => name.endsWith('.ts')).map(name => `engine/${name}`);
await build({entryPoints: entries, outdir: 'lib', bundle: true, splitting: true, format: 'esm', platform: 'neutral', target: 'es2022', external: ['jspdf'], legalComments: 'eof'});
