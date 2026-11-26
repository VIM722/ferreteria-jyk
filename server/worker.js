import { prepararDemo } from './demo.js'
import { activity, audit, can, login, logout, permit, saveUser, session, users, viewUser } from './auth.js'
import { all, body, headers, ids, json, now, number, option, q, RequestError, string } from './http.js'

const categories = ['Herramientas', 'Construcción', 'Electricidad', 'Gasfitería', 'Pinturas', 'Fijaciones', 'Seguridad', 'Otros']
const methods = ['Efectivo', 'Tarjeta', 'Yape / Plin', 'Transferencia']
async function dashboard(db, url, user) {
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
    q(db,'SELECT id,tipo,cliente,fecha,total,pago FROM ventas WHERE ?=1 ORDER BY fecha DESC,id DESC LIMIT 5',can(user,'ventas') ? 1 : 0),
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

async function receipt(db, id, user) {
  const owner = user.rol === 'administrador' ? null : user.id
  const condition = ' AND (? IS NULL OR usuario_id=?)'
  const [sale, items] = (await db.batch([
    q(db, 'SELECT id,fecha,cliente,documento,tipo,pago,total FROM ventas WHERE id=?' + condition, id,owner,owner),
    q(db, 'SELECT nombre,cantidad,precio,descuento FROM partidas WHERE venta_id IN (SELECT id FROM ventas WHERE id=?' + condition + ') ORDER BY nombre', id,owner,owner),
  ])).map(result => result.results)
  if (!sale.length) throw new RequestError('No se encontró la venta.', 404)
  return { ...sale[0], articulos: items }
}
async function createSale(db, input, user) {
  const token = string(input.solicitud, 'La referencia', 36)
  if (!/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(token)) throw new RequestError('La referencia no es válida.')
  const document = string(input.documento ?? '', 'El documento', 11, false)
  const type = option(input.tipo, ['Boleta','Factura'], 'El comprobante')
  const customer = string(input.cliente ?? '', 'El cliente', 100, type === 'Factura') || 'Cliente general'
  if ((type === 'Factura' && !/^\d{11}$/.test(document)) || (type === 'Boleta' && document && !/^(\d{8}|\d{11})$/.test(document))) {
    throw new RequestError('Indica un documento válido para el comprobante.')
  }
  if (!Array.isArray(input.articulos) || input.articulos.length < 1 || input.articulos.length > 30) throw new RequestError('Agrega entre 1 y 30 productos.')
  const queries = [q(db, 'INSERT INTO ventas(solicitud,fecha,cliente,documento,tipo,pago,usuario_id) VALUES (?,?,?,?,?,?,?)',
    token, now(), customer, document, type, option(input.pago, methods, 'El medio de pago'),user.id)]
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
  queries.push(q(db,`INSERT INTO actividad(usuario_id,fecha,accion,detalle)
    SELECT ?,?,'Venta registrada',printf('%s-%05d',CASE WHEN tipo='Boleta' THEN 'B001' ELSE 'F001' END,id)
    FROM ventas WHERE solicitud=?`,user.id,now(),token))
  try {
    await db.batch(queries)
  } catch (error) {
    const existing = await q(db, 'SELECT id FROM ventas WHERE solicitud=? AND usuario_id=?', token,user.id).first()
    if (existing) return receipt(db, existing.id,user)
    if (String(error).includes('UNIQUE constraint failed: ventas.solicitud')) throw new RequestError('Usa una nueva referencia para registrar la venta.',409)
    if (String(error).includes('stock_insuficiente')) throw new RequestError('El stock cambió. Revisa las cantidades del carrito.', 409)
    if (/partidas\.(precio|nombre)/.test(String(error))) throw new RequestError('El catálogo cambió. Revisa el precio y la disponibilidad.', 409)
    throw error
  }
  const row = await q(db, 'SELECT id FROM ventas WHERE solicitud=?', token).first()
  return receipt(db, row.id,user)
}

async function saveProduct(db, data, user, id) {
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
  queries.push(audit(db,user,id ? 'Producto actualizado' : 'Producto creado',sku))
  await db.batch(queries)
  return { ok: true }
}
async function movement(db, data, user) {
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
  queries.push(q(db, "INSERT INTO actividad(usuario_id,fecha,accion,detalle) SELECT ?,?,?,sku || ' · ' || ? || ' unidades' FROM productos WHERE id=?",
    user.id,now(),incoming ? 'Ingreso de inventario' : 'Baja de inventario',quantity,id))
  await db.batch(queries)
  return { ok: true }
}
async function supplier(db, data, user, id) {
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
  queries.push(audit(db,user,id ? 'Proveedor actualizado' : 'Proveedor creado',name))
  await db.batch(queries)
  return { ok: true }
}
function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().startsWith(value)
}
async function sales(db, url, user) {
  const customer = string(url.searchParams.get('cliente') ?? '', 'La búsqueda', 100, false)
  const start = url.searchParams.get('desde') || '1970-01-01'
  const end = url.searchParams.get('hasta') || '9999-12-30'
  if (!validDate(start) || !validDate(end) || start > end || end > '9999-12-30') throw new RequestError('El rango de fechas no es válido.')
  const last = new Date(Date.parse(end + 'T05:00:00Z') + 86400000).toISOString()
  const startAt = start + 'T05:00:00.000Z'
  const page = number(Number(url.searchParams.get('pagina') || '1'), 'La página', 1, 100000)
  const owner = user.rol === 'administrador' ? null : user.id
  const where = `FROM ventas WHERE fecha >= ? AND fecha < ? AND (? IS NULL OR usuario_id=?) AND
    (instr(lower(cliente),lower(?)) > 0 OR ? = documento OR ? = CAST(id AS TEXT)
    OR ? = printf('%s-%05d',CASE WHEN tipo='Boleta' THEN 'B001' ELSE 'F001' END,id) OR ? = '')`
  const args = [startAt,last,owner,owner,customer,customer,customer,customer.toUpperCase(),customer]
  const [rows, count] = (await db.batch([
    q(db, 'SELECT id,fecha,cliente,tipo,pago,total ' + where + ' ORDER BY fecha DESC,id DESC LIMIT 25 OFFSET ?', ...args, (page - 1) * 25),
    q(db, 'SELECT count(*) total ' + where, ...args),
  ])).map(result => result.results)
  return { filas: rows, total: count[0].total }
}

async function catalog(db, user) {
  const full = can(user,'catalogo')
  const warehouse = can(user,'inventario')
  const columns = full ? '*' : warehouse ? 'id,sku,nombre,categoria,costo,stock,minimo' : 'id,sku,nombre,categoria,precio,stock'
  const queries = [db.prepare('SELECT ' + columns + ' FROM productos ORDER BY nombre,id')]
  if (full || warehouse) queries.push(db.prepare('SELECT ' + (full ? '*' : 'id,nombre') + ' FROM proveedores ORDER BY nombre,id'))
  if (full) queries.push(db.prepare('SELECT * FROM producto_proveedor'))
  const [productos, proveedores = [], enlaces = []] = (await db.batch(queries)).map(result => result.results)
  return { productos,proveedores,enlaces,categorias:categories }
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
      const method = request.method
      if (path === '/api/login' && method === 'POST') return await login(db,request,await body(request))
      const user = await session(db,request)
      if (path === '/api/sesion' && method === 'GET') return json(viewUser(user))
      if (path === '/api/logout' && method === 'POST') {
        await body(request)
        return await logout(db,request,user)
      }
      if (path === '/api/usuarios' || /^\/api\/usuarios\/\d+$/.test(path)) {
        permit(user,'usuarios')
        if (method === 'GET' && path === '/api/usuarios') return json(await users(db))
        if (method === 'POST' && path === '/api/usuarios') return json(await saveUser(db,user,await body(request)),201)
        if (method === 'PUT' && path !== '/api/usuarios') {
          const userId = number(Number(path.split('/').pop()),'El código',1,Number.MAX_SAFE_INTEGER)
          return json(await saveUser(db,user,await body(request),userId))
        }
      }
      if (path === '/api/actividad' && method === 'GET') {
        permit(user,'actividad')
        return json(await activity(db))
      }
      await prepararDemo(db)
      if (method === 'GET') {
        if (path === '/api/panel') {
          permit(user,'reportes')
          return json(await dashboard(db,url,user))
        }
        if (path === '/api/catalogo') {
          permit(user,'stock')
          return json(await catalog(db,user))
        }
        if (path === '/api/movimientos') {
          permit(user,'inventario')
          return json(await all(db, 'SELECT m.*,p.nombre,p.sku,s.nombre proveedor FROM movimientos m JOIN productos p ON p.id=m.producto_id LEFT JOIN proveedores s ON s.id=m.proveedor_id ORDER BY m.fecha DESC,m.id DESC LIMIT 100'))
        }
        if (path === '/api/ventas') {
          permit(user,'ventas')
          return json(await sales(db,url,user))
        }
        if (/^\/api\/ventas\/\d+$/.test(path)) {
          permit(user,'ventas')
          return json(await receipt(db,Number(path.split('/').pop()),user))
        }
      }
      if (method === 'POST') {
        if (path === '/api/ventas') {
          permit(user,'ventas')
          return json(await createSale(db,await body(request),user),201)
        }
        if (path === '/api/productos') {
          permit(user,'catalogo')
          return json(await saveProduct(db,await body(request),user),201)
        }
        if (path === '/api/movimientos') {
          permit(user,'inventario')
          return json(await movement(db,await body(request),user),201)
        }
        if (path === '/api/proveedores') {
          permit(user,'proveedores')
          return json(await supplier(db,await body(request),user),201)
        }
      }
      const edit = /^\/api\/(productos|proveedores)\/(\d+)$/.exec(path)
      if (method === 'PUT' && edit) {
        permit(user,edit[1] === 'productos' ? 'catalogo' : 'proveedores')
        const data = await body(request)
        const id = number(Number(edit[2]), 'El código', 1, Number.MAX_SAFE_INTEGER)
        return json(await (edit[1] === 'productos' ? saveProduct(db,data,user,id) : supplier(db,data,user,id)))
      }
      return json({ error: 'No se encontró la operación.' }, 404)
    } catch (error) {
      if (error instanceof RequestError) return json({ error: error.message }, error.status)
      if (error instanceof SyntaxError) return json({ error: 'Los datos enviados no son válidos.' }, 400)
      if (String(error).includes('stock_insuficiente')) return json({ error: 'La cantidad supera el stock disponible.' }, 409)
      if (String(error).includes('UNIQUE constraint failed: usuarios.usuario')) return json({ error: 'Ese nombre de usuario ya está en uso.' },409)
      if (String(error).includes('ultimo_administrador')) return json({ error: 'Debe quedar al menos un administrador activo.' },409)
      if (/UNIQUE constraint failed: (productos.sku|proveedores.nombre)/.test(String(error))) return json({ error: 'Ya existe un registro con ese código o nombre.' }, 409)
      if (String(error).includes('FOREIGN KEY constraint failed')) return json({ error: 'El producto o proveedor seleccionado ya no está disponible.' }, 409)
      console.error(error)
      return json({ error: 'No se pudo completar la operación. Vuelve a intentarlo.' }, 500)
    }
  },
}
