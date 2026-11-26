import { prepararDemo } from './demo.js'

const categories = ['Herramientas', 'Construcción', 'Electricidad', 'Gasfitería', 'Pinturas', 'Fijaciones', 'Seguridad', 'Otros']
const methods = ['Efectivo', 'Tarjeta', 'Yape / Plin', 'Transferencia']
const headers = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; frame-ancestors 'self'; base-uri 'none'; form-action 'self'",
}
const json = (data, status = 200) => Response.json(data, { status, headers: { ...headers, 'Cache-Control': 'no-store' } })
const q = (db, sql, ...args) => db.prepare(sql).bind(...args)
const all = async (db, sql, ...args) => (await q(db, sql, ...args).all()).results
const now = () => new Date().toISOString()

class RequestError extends Error {
  constructor(message, status = 400) {
    super(message)
    this.status = status
  }
}
function string(value, label, max = 100, required = true) {
  if (typeof value !== 'string' || (required && !value.trim()) || value.trim().length > max) {
    throw new RequestError(label + ' no es válido.')
  }
  return value.trim()
}
function number(value, label, min = 0, max = 10000000) {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new RequestError(label + ' no es válido.')
  return value
}
function option(value, choices, label) {
  if (!choices.includes(value)) throw new RequestError(label + ' no es válido.')
  return value
}
function ids(value) {
  if (!Array.isArray(value) || value.length > 50) throw new RequestError('La selección no es válida.')
  return [...new Set(value.map(id => number(id, 'El código', 1, Number.MAX_SAFE_INTEGER)))]
}
async function body(request) {
  if (request.headers.get('origin') && request.headers.get('origin') !== new URL(request.url).origin) {
    throw new RequestError('Origen no autorizado.', 403)
  }
  if (!request.headers.get('content-type')?.startsWith('application/json')) throw new RequestError('Se requiere JSON.', 415)
  const input = await request.text()
  if (input.length > 24000) throw new RequestError('Solicitud demasiado grande.', 413)
  const data = JSON.parse(input)
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new RequestError('Datos no válidos.')
  return data
}

async function dashboard(db, url) {
  const days = url.searchParams.get('dias') === '30' ? 30 : 7
  const last = new Date(Date.now() - 5 * 3600000).toISOString().slice(0, 10)
  const today = new Date(last + 'T05:00:00.000Z').getTime()
  const since = new Date(today - (days - 1) * 86400000).toISOString()
  const previous = new Date(today - (2 * days - 1) * 86400000).toISOString()
  const [daily, previousPeriod, stock, low, recent, rotation] = (await db.batch([
    q(db, "SELECT date(fecha,'-5 hours') dia, sum(total) total, sum(total-costo) margen, count(*) cantidad FROM ventas WHERE fecha >= ? GROUP BY dia", since),
    q(db, 'SELECT COALESCE(sum(total),0) total, count(*) cantidad FROM ventas WHERE fecha >= ? AND fecha < ?', previous, since),
    db.prepare('SELECT count(*) productos, COALESCE(sum(stock <= minimo),0) alertas, COALESCE(sum(stock*costo),0) valor FROM productos'),
    db.prepare('SELECT id,sku,nombre,categoria,stock,minimo FROM productos WHERE stock <= minimo ORDER BY stock,minimo DESC,id LIMIT 6'),
    db.prepare('SELECT id,tipo,cliente,fecha,total,pago FROM ventas ORDER BY fecha DESC,id DESC LIMIT 5'),
    q(db, 'SELECT p.id,p.nombre,p.sku,p.categoria, COALESCE(sum(CASE WHEN v.id IS NOT NULL THEN i.cantidad ELSE 0 END),0) unidades FROM productos p LEFT JOIN partidas i ON i.producto_id=p.id LEFT JOIN ventas v ON v.id=i.venta_id AND v.fecha >= ? GROUP BY p.id ORDER BY unidades DESC,p.nombre', since),
  ])).map(result => result.results)
  const byDate = new Map(daily.map(item => [item.dia, item]))
  const series = Array.from({ length: days }, (_, index) => {
    const dia = new Date(today - (days - index - 1) * 86400000).toISOString().slice(0, 10)
    return byDate.get(dia) ?? { dia, total: 0 }
  })
  const add = name => daily.reduce((sum, item) => sum + item[name], 0)
  return {
    total: add('total'), ventas: add('cantidad'), margen: add('margen'),
    anterior: previousPeriod[0], inventario: stock[0], alertas: low, recientes: recent,
    serie: series, rotacion: rotation, dias: days,
  }
}

async function receipt(db, id) {
  const [sale, items] = (await db.batch([
    q(db, 'SELECT id,fecha,cliente,documento,tipo,pago,total FROM ventas WHERE id=?', id),
    q(db, 'SELECT nombre,cantidad,precio,descuento FROM partidas WHERE venta_id=? ORDER BY nombre', id),
  ])).map(result => result.results)
  if (!sale.length) throw new RequestError('No se encontró la venta.', 404)
  return { ...sale[0], articulos: items }
}
async function createSale(db, input) {
  const token = string(input.solicitud, 'La referencia', 36)
  if (!/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(token)) throw new RequestError('La referencia no es válida.')
  const document = string(input.documento ?? '', 'El documento', 11, false)
  const type = option(input.tipo, ['Boleta','Factura'], 'El comprobante')
  const customer = string(input.cliente ?? '', 'El cliente', 100, type === 'Factura') || 'Cliente general'
  if ((type === 'Factura' && !/^\d{11}$/.test(document)) || (type === 'Boleta' && document && !/^(\d{8}|\d{11})$/.test(document))) {
    throw new RequestError('Indica un documento válido para el comprobante.')
  }
  if (!Array.isArray(input.articulos) || input.articulos.length < 1 || input.articulos.length > 30) throw new RequestError('Agrega entre 1 y 30 productos.')
  const queries = [q(db, 'INSERT INTO ventas(solicitud,fecha,cliente,documento,tipo,pago) VALUES (?,?,?,?,?,?)',
    token, now(), customer, document, type, option(input.pago, methods, 'El medio de pago'))]
  const products = new Set()
  for (const item of input.articulos) {
    const id = number(item?.id, 'El producto', 1, Number.MAX_SAFE_INTEGER)
    if (products.has(id)) throw new RequestError('El carrito tiene productos duplicados.')
    products.add(id)
    const qty = number(item.cantidad, 'La cantidad', 1, 10000)
    const price = number(item.precio, 'El precio esperado', 1)
    const discount = number(item.descuento ?? 0, 'El descuento', 0, qty * price)
    queries.push(q(db, 'INSERT INTO partidas VALUES ((SELECT id FROM ventas WHERE solicitud=?),?, (SELECT nombre FROM productos WHERE id=?),?, (SELECT precio FROM productos WHERE id=? AND precio=?),(SELECT costo FROM productos WHERE id=?),?)',
      token, id, id, qty, id, price, id, discount))
  }
  try {
    await db.batch(queries)
  } catch (error) {
    const existing = await q(db, 'SELECT id FROM ventas WHERE solicitud=?', token).first()
    if (existing) return receipt(db, existing.id)
    if (String(error).includes('stock_insuficiente')) throw new RequestError('El stock cambió. Revisa las cantidades del carrito.', 409)
    if (/partidas\.(precio|nombre)/.test(String(error))) throw new RequestError('El catálogo cambió. Revisa el precio y la disponibilidad.', 409)
    throw error
  }
  const row = await q(db, 'SELECT id FROM ventas WHERE solicitud=?', token).first()
  return receipt(db, row.id)
}

async function saveProduct(db, data, id) {
  const sku = string(data.sku, 'El SKU', 32).toUpperCase()
  const name = string(data.nombre, 'El nombre')
  const category = option(data.categoria, categories, 'La categoría')
  const price = number(data.precio, 'El precio', 1)
  const minimum = number(data.minimo, 'El stock mínimo', 0, 100000)
  const suppliers = ids(data.proveedores ?? [])
  const queries = []
  if (id) {
    if (!(await q(db, 'SELECT id FROM productos WHERE id=?', id).first())) throw new RequestError('Producto no encontrado.', 404)
    queries.push(q(db, 'UPDATE productos SET sku=?,nombre=?,categoria=?,precio=?,minimo=? WHERE id=?', sku,name,category,price,minimum,id))
    queries.push(q(db, 'DELETE FROM producto_proveedor WHERE producto_id=?', id))
  } else {
    const cost = number(data.costo, 'El costo')
    const stock = number(data.stock, 'El stock inicial', 0, 100000)
    queries.push(q(db, 'INSERT INTO productos(sku,nombre,categoria,precio,costo,minimo) VALUES (?,?,?,?,?,?)', sku,name,category,price,cost,minimum))
    if (stock) queries.push(q(db, "INSERT INTO movimientos(producto_id,fecha,tipo,cantidad,costo,motivo) VALUES ((SELECT id FROM productos WHERE sku=?),?,'Inicial',?,?,'Stock inicial')", sku,now(),stock,cost))
  }
  suppliers.forEach(supplier => queries.push(q(db, 'INSERT INTO producto_proveedor VALUES ((SELECT id FROM productos WHERE sku=?),?)', sku,supplier)))
  await db.batch(queries)
  return { ok: true }
}
async function movement(db, data) {
  const id = number(data.id, 'El producto', 1, Number.MAX_SAFE_INTEGER)
  const type = option(data.tipo, ['Ingreso','Baja'], 'El movimiento')
  const quantity = number(data.cantidad, 'La cantidad', 1, 100000)
  const incoming = type === 'Ingreso'
  const supplier = incoming ? number(data.proveedor, 'El proveedor', 1, Number.MAX_SAFE_INTEGER) : null
  const cost = incoming ? number(data.costo, 'El costo') : null
  const reason = incoming ? 'Ingreso de mercadería' : string(data.motivo, 'El motivo', 160)
  const queries = [q(db, 'INSERT INTO movimientos(producto_id,proveedor_id,fecha,tipo,cantidad,costo,motivo) VALUES (?,?,?,?,?,?,?)',
    id,supplier,now(),type,incoming ? quantity : -quantity,cost,reason)]
  if (incoming) queries.push(q(db, 'INSERT OR IGNORE INTO producto_proveedor VALUES (?,?)', id,supplier))
  await db.batch(queries)
  return { ok: true }
}
async function supplier(db, data, id) {
  const name = string(data.nombre, 'El proveedor')
  const contact = string(data.contacto ?? '', 'El contacto', 100, false)
  const email = string(data.correo ?? '', 'El correo', 120, false)
  const phone = string(data.telefono ?? '', 'El teléfono', 30, false)
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new RequestError('El correo no es válido.')
  const products = ids(data.productos ?? [])
  const queries = []
  if (id) {
    if (!(await q(db, 'SELECT id FROM proveedores WHERE id=?', id).first())) throw new RequestError('Proveedor no encontrado.', 404)
    queries.push(q(db, 'UPDATE proveedores SET nombre=?,contacto=?,correo=?,telefono=? WHERE id=?', name,contact,email,phone,id))
    queries.push(q(db, 'DELETE FROM producto_proveedor WHERE proveedor_id=?', id))
  } else {
    queries.push(q(db, 'INSERT INTO proveedores(nombre,contacto,correo,telefono) VALUES (?,?,?,?)', name,contact,email,phone))
  }
  products.forEach(product => queries.push(q(db, 'INSERT INTO producto_proveedor VALUES (?,(SELECT id FROM proveedores WHERE nombre=?))', product,name)))
  await db.batch(queries)
  return { ok: true }
}
function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().startsWith(value)
}
async function sales(db, url) {
  const customer = string(url.searchParams.get('cliente') ?? '', 'La búsqueda', 100, false)
  const start = url.searchParams.get('desde') || '1970-01-01'
  const end = url.searchParams.get('hasta') || '9999-12-30'
  if (!validDate(start) || !validDate(end) || start > end || end > '9999-12-30') throw new RequestError('El rango de fechas no es válido.')
  const last = new Date(Date.parse(end + 'T05:00:00Z') + 86400000).toISOString()
  const startAt = start + 'T05:00:00.000Z'
  const page = number(Number(url.searchParams.get('pagina') || '1'), 'La página', 1, 100000)
  const where = 'FROM ventas WHERE fecha >= ? AND fecha < ? AND (instr(lower(cliente),lower(?)) > 0 OR ? = documento OR ? = CAST(id AS TEXT) OR ? = printf(\'%s-%05d\', CASE WHEN tipo=\'Boleta\' THEN \'B001\' ELSE \'F001\' END, id) OR ? = \'\')'
  const args = [startAt,last,customer,customer,customer,customer.toUpperCase(),customer]
  const [rows, count] = (await db.batch([
    q(db, 'SELECT id,fecha,cliente,tipo,pago,total ' + where + ' ORDER BY fecha DESC,id DESC LIMIT 25 OFFSET ?', ...args, (page - 1) * 25),
    q(db, 'SELECT count(*) total ' + where, ...args),
  ])).map(result => result.results)
  return { filas: rows, total: count[0].total }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    const path = url.pathname
    if (!path.startsWith('/api/')) {
      const asset = env.localAssets?.[path] ?? (typeof assets === 'undefined' ? null : assets[path])
      if (!asset || !['GET','HEAD'].includes(request.method)) return new Response('No encontrado', { status: 404 })
      const [type, content] = asset
      const data = type.startsWith('image/') && typeof content === 'string' ? Uint8Array.from(atob(content), char => char.charCodeAt(0)) : content
      return new Response(request.method === 'HEAD' ? null : data, { headers: { ...headers, 'Content-Type': type, 'Cache-Control': type.startsWith('image/') ? 'public,max-age=86400' : 'no-cache' } })
    }
    try {
      if (!env.LOCAL_PREVIEW && !request.headers.get('oai-authenticated-user-id')) return json({ error: 'Inicia sesión para continuar.' }, 401)
      const db = env.DB
      if (!db) return json({ error: 'La base de datos no está disponible.' }, 503)
      await prepararDemo(db)
      const method = request.method
      if (method === 'GET') {
        if (path === '/api/panel') return json(await dashboard(db, url))
        if (path === '/api/catalogo') {
          const [productos, proveedores, enlaces] = (await db.batch([
            db.prepare('SELECT * FROM productos ORDER BY nombre,id'),
            db.prepare('SELECT * FROM proveedores ORDER BY nombre,id'),
            db.prepare('SELECT * FROM producto_proveedor'),
          ])).map(result => result.results)
          return json({ productos, proveedores, enlaces, categorias: categories })
        }
        if (path === '/api/movimientos') return json(await all(db, 'SELECT m.*,p.nombre,p.sku,s.nombre proveedor FROM movimientos m JOIN productos p ON p.id=m.producto_id LEFT JOIN proveedores s ON s.id=m.proveedor_id ORDER BY m.fecha DESC,m.id DESC LIMIT 100'))
        if (path === '/api/ventas') return json(await sales(db, url))
        if (/^\/api\/ventas\/\d+$/.test(path)) return json(await receipt(db, Number(path.split('/').pop())))
      }
      if (method === 'POST') {
        if (path === '/api/ventas') return json(await createSale(db, await body(request)), 201)
        if (path === '/api/productos') return json(await saveProduct(db, await body(request)), 201)
        if (path === '/api/movimientos') return json(await movement(db, await body(request)), 201)
        if (path === '/api/proveedores') return json(await supplier(db, await body(request)), 201)
      }
      const edit = /^\/api\/(productos|proveedores)\/(\d+)$/.exec(path)
      if (method === 'PUT' && edit) {
        const data = await body(request)
        const id = number(Number(edit[2]), 'El código', 1, Number.MAX_SAFE_INTEGER)
        return json(await (edit[1] === 'productos' ? saveProduct(db, data, id) : supplier(db, data, id)))
      }
      return json({ error: 'No se encontró la operación.' }, 404)
    } catch (error) {
      if (error instanceof RequestError) return json({ error: error.message }, error.status)
      if (error instanceof SyntaxError) return json({ error: 'Los datos enviados no son válidos.' }, 400)
      if (String(error).includes('stock_insuficiente')) return json({ error: 'La cantidad supera el stock disponible.' }, 409)
      if (/UNIQUE constraint failed: (productos.sku|proveedores.nombre)/.test(String(error))) return json({ error: 'Ya existe un registro con ese código o nombre.' }, 409)
      if (String(error).includes('FOREIGN KEY constraint failed')) return json({ error: 'El producto o proveedor seleccionado ya no está disponible.' }, 409)
      console.error(error)
      return json({ error: 'No se pudo completar la operación. Vuelve a intentarlo.' }, 500)
    }
  },
}
