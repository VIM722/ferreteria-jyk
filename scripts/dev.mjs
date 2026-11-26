import { createServer } from 'node:http'
import { Readable } from 'node:stream'
import { readFileSync, mkdirSync } from 'node:fs'
import worker from '../server/worker.js'
import { database } from './local-db.mjs'

const port = Number(process.env.PORT || 8080)
mkdirSync('.data', { recursive: true })
const DB = database(process.env.DEMO_DATABASE || '.data/ferreteria.sqlite')
const assetTypes = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/styles.css': ['styles.css', 'text/css; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/herramientas.webp': ['herramientas.webp', 'image/webp'],
}
createServer(async (incoming, outgoing) => {
  try {
    const host = incoming.headers.host
    if (!['localhost:' + port, '127.0.0.1:' + port].includes(host)) {
      outgoing.writeHead(403).end()
      return
    }
    const url = new URL(incoming.url, 'http://' + host)
    const request = new Request(url, {
      method: incoming.method,
      headers: incoming.headers,
      ...(!['GET','HEAD'].includes(incoming.method) && { body: Readable.toWeb(incoming), duplex: 'half' }),
    })
    const asset = assetTypes[url.pathname]
    const localAssets = asset
      ? { [url.pathname]: [asset[1], readFileSync(new URL('../public/' + asset[0], import.meta.url))] }
      : {}
    const response = await worker.fetch(request, { DB, LOCAL_PREVIEW: true, localAssets })
    outgoing.writeHead(response.status, Object.fromEntries(response.headers))
    if (response.body) Readable.fromWeb(response.body).pipe(outgoing)
    else outgoing.end()
  } catch (error) {
    console.error(error)
    outgoing.writeHead(500).end()
  }
}).listen(port, '127.0.0.1', () => console.log('Ferretería JyK disponible en http://localhost:' + port))
