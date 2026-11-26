import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const at = path => new URL(path, root);
const [template, css, bundle] = await Promise.all([
  readFile(at('web/index.html'), 'utf8'),
  readFile(at('web/style.css'), 'utf8'),
  build({
    entryPoints: [fileURLToPath(at('web/app.mjs'))],
    bundle: true,
    write: false,
    format: 'iife',
    target: 'es2020',
    minify: true,
    legalComments: 'none',
  }),
]);

// The module normally defers until parsing finishes. Mount the inline build
// at the end of the body to preserve that ordering when opened as a file.
const cssTag = '<link rel="stylesheet" href="./style.css">';
const jsTag = '  <script src="./app.mjs" type="module"></script>\n';
for (const anchor of [cssTag, jsTag, '</body>']) {
  if (template.split(anchor).length !== 2) throw new Error('Missing or repeated build anchor: ' + anchor);
}
const script = bundle.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const html = template
  .replace(cssTag, () => '<style>\n' + css + '\n</style>')
  .replace(jsTag, '')
  .replace('</body>', () => '<script>\n' + script + '</script>\n</body>');
await mkdir(at('docs/'), { recursive: true });
await writeFile(at('docs/index.html'), html);
console.log('Built docs/index.html (' + Buffer.byteLength(html) + ' bytes).');
