import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'

const assetTypes = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/styles.css': ['styles.css', 'text/css; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/herramientas.webp': ['herramientas.webp', 'image/webp'],
}
const assets = {}
for (const [path, [file, type]] of Object.entries(assetTypes)) {
  const data = await readFile(new URL('../public/' + file, import.meta.url))
  assets[path] = [type, type.startsWith('image/') ? data.toString('base64') : data.toString('utf8')]
}
const seed = await readFile(new URL('../server/demo.js', import.meta.url), 'utf8')
const worker = await readFile(new URL('../server/worker.js', import.meta.url), 'utf8')
const combined = [
  'const assets = ' + JSON.stringify(assets),
  seed.replace(/^export /gm, ''),
  worker.replace(/^import .*\n/m, ''),
].join('\n')

await mkdir('dist/server', { recursive: true })
await mkdir('dist/.openai', { recursive: true })
await copyFile('.openai/hosting.json', 'dist/.openai/hosting.json')
await writeFile('dist/server/index.js', combined)
console.log('Worker preparado en dist/server/index.js')
