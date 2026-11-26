import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, readFileSync, rmdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import worker from '../server/worker.js'
import { database } from '../scripts/local-db.mjs'
import { hashPassword, provisionarUsuarios } from '../server/auth.js'

async function request(db, path, method = 'GET', data, cookie) {
  const result = await worker.fetch(new Request('http://localhost/api/' + path, {
    method, headers: {
      ...(cookie && { Cookie: cookie }),
      ...(data && { 'Content-Type': 'application/json', Origin: 'http://localhost' }),
    }, ...(data && { body: JSON.stringify(data) }),
  }), { DB: db, LOCAL_PREVIEW: true })
  return { status: result.status, data: await result.json(), cookie: result.headers.get('set-cookie')?.split(';')[0] }
}
const testPassword = 'Solo-pruebas-1234'
async function fixture(t) {
  const db = database(':memory:')
  t.after(() => db.close())
  await provisionarUsuarios(db)
  const { salt,hash } = await hashPassword(testPassword)
  db.prepare('UPDATE usuarios SET sal=?,clave_hash=?').bind(salt,hash).run()
  async function as(usuario, clave = testPassword) {
    const signed = await request(db,'login','POST',{usuario,clave})
    assert.equal(signed.status,200)
    return (path,method,data) => request(db,path,method,data,signed.cookie)
  }
  return { db,as }
}
const sale = (articulos, solicitud = crypto.randomUUID()) => ({ solicitud, cliente: 'Verificación', tipo: 'Boleta', pago: 'Tarjeta', articulos })
const line = (product, cantidad = 1, descuento = 0) => ({ id: product.id, precio: product.precio, cantidad, descuento })

test('registra el carrito, descuenta stock y devuelve el mismo comprobante ante un reintento', async t => {
  const { as } = await fixture(t)
  const seller = await as('vendedor')
  const catalog = await seller('catalogo')
  assert.equal(catalog.status,200)
  const [first,second] = catalog.data.productos
  const payload = sale([line(first,2,200),line(second)])
  const created = await seller('ventas','POST',payload)
  assert.equal(created.status,201)
  assert.equal(created.data.total,first.precio*2+second.precio-200)
  assert.equal(created.data.articulos.length,2)
  const repeated = await seller('ventas','POST',payload)
  assert.equal(repeated.data.id,created.data.id)
  const after = (await seller('catalogo')).data.productos
  assert.equal(after.find(p => p.id === first.id).stock,first.stock-2)
  assert.equal(after.find(p => p.id === second.id).stock,second.stock-1)
  const filtered = await seller('ventas?cliente=Verifica')
  assert.equal(filtered.data.total,1)
  assert.equal(filtered.data.filas[0].id,created.data.id)
})

test('revierte una venta de varias partidas si una excede el stock', async t => {
  const { as } = await fixture(t)
  const seller = await as('vendedor')
  const catalog = (await seller('catalogo')).data
  const [first,second] = catalog.productos
  const failure = await seller('ventas','POST',sale([line(first),line(second,second.stock+1)]))
  assert.equal(failure.status,409)
  const after = (await seller('catalogo')).data
  assert.deepEqual(after.productos,catalog.productos)
  assert.equal((await seller('ventas?cliente=Verifica')).data.total,0)
})

test('registra ingreso y baja, actualiza el costo promedio y rechaza una baja mayor al saldo', async t => {
  const { as } = await fixture(t)
  const warehouse = await as('almacenero')
  const owner = await as('dueno')
  const { productos, proveedores } = (await warehouse('catalogo')).data
  const p = productos[0]
  const supplier = proveedores[0]
  const incoming = await warehouse('movimientos','POST',{ id: p.id,tipo: 'Ingreso',cantidad: 20,costo: 1800,proveedor: supplier.id })
  assert.equal(incoming.status,201)
  const removal = { id: p.id,tipo: 'Baja',cantidad: 2,motivo: 'Deterioro' }
  assert.equal((await warehouse('movimientos','POST',removal)).status,201)
  assert.equal((await warehouse('movimientos','POST',{ ...removal,cantidad: p.stock+21 })).status,409)
  const current = (await warehouse('catalogo')).data.productos.find(item => item.id === p.id)
  assert.equal(current.stock,p.stock+18)
  assert.equal(current.costo,Math.round((p.costo*p.stock+1800*20)/(p.stock+20)))
  assert.equal((await owner('panel?dias=30')).data.serie.length,30)
})

test('la API alojada exige sesión y rechaza escrituras de otro origen', async t => {
  const db = database(':memory:')
  t.after(() => db.close())
  let response = await worker.fetch(new Request('https://jyk.example/api/catalogo'),{ DB: db })
  assert.equal(response.status,401)
  response = await worker.fetch(new Request('https://jyk.example/api/login',{
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://otro.example', 'oai-authenticated-user-id': 'owner' }, body: '{}',
  }),{ DB: db })
  assert.equal(response.status,403)
})

test('la API aplica la matriz de permisos y limita los datos que entrega por rol', async t => {
  const { db,as } = await fixture(t)
  assert.equal((await request(db,'ventas')).status,401)
  assert.equal((await request(db,'login','POST',{usuario:'vendedor',clave:'incorrecta'})).status,401)
  const seller = await as('vendedor')
  const warehouse = await as('almacenero')
  const owner = await as('dueno')
  const admin = await as('admin')
  assert.equal((await seller('ventas')).status,200)
  assert.equal((await seller('movimientos')).status,403)
  assert.equal((await seller('panel')).status,403)
  assert.equal((await seller('productos','POST',{})).status,403)
  assert.equal((await seller('usuarios')).status,403)
  const saleCatalog = (await seller('catalogo')).data
  assert.equal(saleCatalog.proveedores.length,0)
  assert.equal('costo' in saleCatalog.productos[0],false)
  assert.equal((await warehouse('movimientos')).status,200)
  assert.equal((await warehouse('ventas','POST',{})).status,403)
  assert.equal((await warehouse('productos','POST',{})).status,403)
  const warehouseCatalog = (await warehouse('catalogo')).data
  assert.equal('correo' in warehouseCatalog.proveedores[0],false)
  assert.equal('precio' in warehouseCatalog.productos[0],false)
  assert.equal((await owner('ventas')).status,403)
  assert.equal((await owner('movimientos','POST',{})).status,403)
  const product = {sku:'PRUEBA-01',nombre:'Producto de prueba',categoria:'Otros',precio:1500,costo:1000,stock:5,minimo:1}
  assert.equal((await owner('productos','POST',product)).status,201)
  assert.equal((await owner('panel')).data.recientes.length,0)
  assert.equal((await admin('usuarios')).data.length,4)
  assert.ok((await admin('actividad')).data.some(entry => entry.accion === 'Producto creado'))
  const first = saleCatalog.productos[0]
  const adminSale = await admin('ventas','POST',sale([line(first)]))
  assert.equal(adminSale.status,201)
  assert.equal((await seller('ventas/' + adminSale.data.id)).status,404)
  assert.equal((await seller('ventas?cliente=Verifica')).data.total,0)
})

test('el administrador puede crear, editar y desactivar cuentas y revoca sus sesiones', async t => {
  const { db,as } = await fixture(t)
  const admin = await as('admin')
  const account = { usuario:'pruebas',nombre:'Cuenta de prueba',rol:'vendedor',activo:true,clave:testPassword }
  assert.equal((await admin('usuarios','POST',account)).status,201)
  const existing = (await admin('usuarios')).data.find(row => row.usuario === account.usuario)
  assert.equal('clave_hash' in existing,false)
  const other = await as(account.usuario)
  assert.equal((await other('ventas')).status,200)
  assert.equal((await admin('usuarios/' + existing.id,'PUT',{ ...account,rol:'almacenero',clave:'' })).status,200)
  assert.equal((await other('sesion')).status,401)
  const changed = await as(account.usuario)
  assert.equal((await changed('ventas')).status,403)
  assert.equal((await changed('movimientos')).status,200)
  assert.equal((await admin('usuarios/' + existing.id,'PUT',{ ...account,rol:'almacenero',activo:false,clave:'' })).status,200)
  assert.equal((await changed('movimientos')).status,401)
  assert.equal((await request(db,'login','POST',{usuario:account.usuario,clave:testPassword})).status,401)
  const me = (await admin('sesion')).data
  assert.equal((await admin('usuarios/' + me.id,'PUT',{ ...me,activo:false,clave:'' })).status,409)
  assert.equal((await admin('logout','POST',{})).status,200)
  assert.equal((await admin('sesion')).status,401)
})

test('la migración conserva ventas anteriores y asigna las de demostración al vendedor inicial', async () => {
  const directory = mkdtempSync(join(tmpdir(),'jyk-migracion-'))
  const path = join(directory,'ferreteria.sqlite')
  const legacy = new DatabaseSync(path)
  try {
    legacy.exec(readFileSync(new URL('../drizzle/0000_inicial.sql',import.meta.url),'utf8'))
    legacy.exec("CREATE TABLE migraciones(archivo TEXT PRIMARY KEY); INSERT INTO migraciones VALUES ('0000_inicial.sql');")
    legacy.exec("INSERT INTO ventas(id,solicitud,fecha,cliente,documento,tipo,pago,total) VALUES (1,'demo-1','2026-11-26','Cliente general','','Boleta','Efectivo',1500),(2,'anterior','2026-11-26','Cliente anterior','','Boleta','Efectivo',2800)")
  } finally {
    legacy.close()
  }
  try {
    const db = database(path)
    try {
      await provisionarUsuarios(db)
      const rows = db.prepare('SELECT v.total,u.usuario FROM ventas v LEFT JOIN usuarios u ON u.id=v.usuario_id ORDER BY v.id').all().results
      assert.deepEqual(rows.map(row => [row.total,row.usuario]),[[1500,'vendedor'],[2800,null]])
    } finally {
      db.close()
    }
  } finally {
    rmSync(path,{force:true})
    rmdirSync(directory)
  }
})
