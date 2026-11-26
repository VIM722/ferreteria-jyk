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
  }), { DB: db })
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

test('el acceso público usa credenciales propias y protege la API, los roles y el origen de escritura', async t => {
  const { db } = await fixture(t)
  const site = 'https://jyk.example'
  const fetch = (path, options) => worker.fetch(new Request(site + '/api/' + path, options), { DB:db })
  for (const path of ['catalogo','ventas','movimientos','panel','usuarios','actividad']) {
    assert.equal((await fetch(path)).status,401)
  }
  const credentials = JSON.stringify({usuario:'vendedor',clave:testPassword})
  let response = await fetch('login',{
    method:'POST', headers:{'Content-Type':'application/json',Origin:'https://otro.example'}, body:credentials,
  })
  assert.equal(response.status,403)
  response = await fetch('login',{
    method:'POST', headers:{'Content-Type':'application/json',Origin:site}, body:credentials,
  })
  assert.equal(response.status,200)
  assert.equal((await response.json()).rol,'vendedor')
  const sessionCookie = response.headers.get('set-cookie')
  assert.match(sessionCookie,/HttpOnly; SameSite=Strict/)
  assert.match(sessionCookie,/; Secure/)
  const headers = { Cookie:sessionCookie.split(';')[0] }
  db.prepare("UPDATE sesiones SET identidad='sesion-del-despliegue-anterior'").run()
  assert.equal((await fetch('catalogo',{ headers })).status,200)
  assert.equal((await fetch('usuarios',{ headers })).status,403)
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
  assert.equal((await admin('usuarios')).data.length,6)
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

test('el asistente usa los datos activos, calcula reposición y recomienda pares recurrentes', async t => {
  const { as } = await fixture(t)
  const owner = await as('dueno')
  const seller = await as('ventas2')
  const warehouse = await as('almacen2')
  assert.equal((await seller('sesion')).data.rol,'vendedor')
  assert.equal((await warehouse('sesion')).data.rol,'almacenero')
  assert.equal((await seller('asistente','POST',{mensaje:'Más vendidos'})).status,403)
  assert.equal((await warehouse('asistente','POST',{mensaje:'Más vendidos'})).status,403)
  assert.equal((await warehouse('movimientos')).status,200)

  const catalog = (await seller('catalogo')).data.productos
  assert.equal(catalog.length,36)
  const nails = catalog.find(row => row.sku === 'FIJ-101')
  const hammer = catalog.find(row => row.sku === 'HER-005')
  const sample = (await owner('asistente','POST',{mensaje:'Recomendaciones',dias:7,horizonte:14})).data
  assert.equal(sample.periodo.demo,true)
  assert.ok(sample.bloques.find(block => block.tipo === 'promociones').filas.some(pair => pair.juntos >= 2))

  for (let i = 0; i < 2; i++) {
    const newSale = await seller('ventas','POST',sale([line(nails,2),line(hammer)]))
    assert.equal(newSale.status,201)
  }
  const sales = (await seller('ventas')).data
  assert.equal(sales.total,2)
  const firstSeller = await as('vendedor')
  assert.equal((await firstSeller('ventas/' + sales.filas[0].id)).status,404)
  const real = (await owner('asistente','POST',{mensaje:'Más vendidos, reposición y promociones en los últimos 7 días',horizonte:60})).data
  assert.equal(real.periodo.demo,false)
  assert.equal(real.periodo.comprobantes,2)
  const [ranking,replenishment,promotions] = real.bloques
  assert.deepEqual(ranking.filas.map(row => row.unidades),[4,2])
  const replenishmentNails = replenishment.filas.find(row => row.sku === nails.sku)
  assert.equal(replenishmentNails.demanda,35)
  assert.equal(replenishmentNails.pedido,35 + replenishmentNails.minimo - replenishmentNails.stock)
  assert.equal(promotions.filas.length,1)
  assert.equal(promotions.filas[0].juntos,2)
  assert.ok(promotions.filas[0].precioCombo < promotions.filas[0].precioHabitual)
  const followUp = (await owner('asistente','POST',{mensaje:'¿Y en 2 semanas?',temas:['reposicion']})).data
  assert.equal(followUp.periodo.horizonte,14)
  assert.deepEqual(followUp.temas,['reposicion'])
  const nextWeek = (await owner('asistente','POST',{mensaje:'¿Qué debo comprar la próxima semana?'})).data
  assert.equal(nextWeek.periodo.horizonte,7)
})

test('el catálogo ampliado conserva SKUs existentes y no crea ventas de ejemplo con actividad operativa previa', async t => {
  const { db,as } = await fixture(t)
  const owner = await as('dueno')
  db.prepare("INSERT INTO configuracion VALUES ('demo')").run()
  db.prepare("INSERT INTO productos(sku,nombre,categoria,precio,costo,minimo) VALUES ('FIJ-101','Producto previo','Fijaciones',2200,1800,2)").run()
  db.prepare("INSERT INTO ventas(solicitud,fecha,cliente,documento,tipo,pago) VALUES ('anterior','2026-11-26','Cliente anterior','','Boleta','Efectivo')").run()
  const catalog = (await owner('catalogo')).data.productos
  const existing = catalog.find(row => row.sku === 'FIJ-101')
  assert.equal(existing.nombre,'Producto previo')
  assert.equal(existing.precio,2200)
  assert.equal(catalog.find(row => row.sku === 'FIJ-102').stock,0)
  const simulated = db.prepare("SELECT count(*) n FROM ventas WHERE solicitud GLOB 'demo-canasta-*'").first()
  assert.equal(simulated.n,0)
})
