import assert from 'node:assert/strict'
import { test } from 'node:test'
import worker from '../server/worker.js'
import { database } from '../scripts/local-db.mjs'

async function request(db, path, method = 'GET', data) {
  const result = await worker.fetch(new Request('http://localhost/api/' + path, {
    method, ...(data && { headers: { 'Content-Type': 'application/json', Origin: 'http://localhost' }, body: JSON.stringify(data) }),
  }), { DB: db, LOCAL_PREVIEW: true })
  return { status: result.status, data: await result.json() }
}
const sale = (articulos, solicitud = crypto.randomUUID()) => ({ solicitud, cliente: 'Verificación', tipo: 'Boleta', pago: 'Tarjeta', articulos })
const line = (product, cantidad = 1, descuento = 0) => ({ id: product.id, precio: product.precio, cantidad, descuento })

test('registra el carrito, descuenta stock y devuelve el mismo comprobante ante un reintento', async t => {
  const db = database(':memory:')
  t.after(() => db.close())
  const catalog = await request(db,'catalogo')
  assert.equal(catalog.status,200)
  const [first,second] = catalog.data.productos
  const payload = sale([line(first,2,200),line(second)])
  const created = await request(db,'ventas','POST',payload)
  assert.equal(created.status,201)
  assert.equal(created.data.total,first.precio*2+second.precio-200)
  assert.equal(created.data.articulos.length,2)
  const repeated = await request(db,'ventas','POST',payload)
  assert.equal(repeated.data.id,created.data.id)
  const after = (await request(db,'catalogo')).data.productos
  assert.equal(after.find(p => p.id === first.id).stock,first.stock-2)
  assert.equal(after.find(p => p.id === second.id).stock,second.stock-1)
  const filtered = await request(db,'ventas?cliente=Verifica')
  assert.equal(filtered.data.total,1)
  assert.equal(filtered.data.filas[0].id,created.data.id)
})

test('revierte una venta de varias partidas si una excede el stock', async t => {
  const db = database(':memory:')
  t.after(() => db.close())
  const catalog = (await request(db,'catalogo')).data
  const [first,second] = catalog.productos
  const failure = await request(db,'ventas','POST',sale([line(first),line(second,second.stock+1)]))
  assert.equal(failure.status,409)
  const after = (await request(db,'catalogo')).data
  assert.deepEqual(after.productos,catalog.productos)
  assert.equal((await request(db,'ventas?cliente=Verifica')).data.total,0)
})

test('registra ingreso y baja, actualiza el costo promedio y rechaza una baja mayor al saldo', async t => {
  const db = database(':memory:')
  t.after(() => db.close())
  const { productos, proveedores } = (await request(db,'catalogo')).data
  const p = productos[0]
  const supplier = proveedores[0]
  const incoming = await request(db,'movimientos','POST',{ id: p.id,tipo: 'Ingreso',cantidad: 20,costo: 1800,proveedor: supplier.id })
  assert.equal(incoming.status,201)
  const removal = { id: p.id,tipo: 'Baja',cantidad: 2,motivo: 'Deterioro' }
  assert.equal((await request(db,'movimientos','POST',removal)).status,201)
  assert.equal((await request(db,'movimientos','POST',{ ...removal,cantidad: p.stock+21 })).status,409)
  const current = (await request(db,'catalogo')).data.productos.find(item => item.id === p.id)
  assert.equal(current.stock,p.stock+18)
  assert.equal(current.costo,Math.round((p.costo*p.stock+1800*20)/(p.stock+20)))
  assert.ok((await request(db,'panel?dias=30')).data.serie.length === 30)
})

test('la API alojada exige sesión y rechaza escrituras de otro origen', async t => {
  const db = database(':memory:')
  t.after(() => db.close())
  let response = await worker.fetch(new Request('https://jyk.example/api/catalogo'),{ DB: db })
  assert.equal(response.status,401)
  response = await worker.fetch(new Request('https://jyk.example/api/ventas',{
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://otro.example', 'oai-authenticated-user-id': 'owner' }, body: '{}',
  }),{ DB: db })
  assert.equal(response.status,403)
})
