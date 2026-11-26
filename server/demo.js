import { all, now, q } from './http.js'

const demoSeller = "(SELECT id FROM usuarios WHERE rol='vendedor' ORDER BY (usuario='vendedor1') DESC,id LIMIT 1)"

export async function prepararDemo(db) {
  if (await db.prepare("SELECT clave FROM configuracion WHERE clave = 'demo'").first()) return
  const data = [
    ['HER-001','Taladro percutor 650 W','Herramientas',18990,13500,32,5],
    ['CON-001','Cemento Portland 42.5 kg','Construcción',3050,2450,90,10],
    ['ELE-002','Cable THW 12 AWG (m)','Electricidad',390,245,42,15],
    ['PLO-003','Tubo PVC ½″ × 3 m','Gasfitería',1190,740,4,8],
    ['PIN-004','Pintura látex blanca 1 gal','Pinturas',8590,6100,43,5],
    ['HER-005','Martillo de uña 16 oz','Herramientas',3290,2150,45,4],
    ['CON-006','Tornillo drywall (caja)','Fijaciones',1590,850,47,8],
    ['HER-007','Disco de corte 4½″','Herramientas',850,495,2,6],
    ['PIN-008','Brocha de 3″','Pinturas',1250,690,72,10],
    ['PLO-009','Cinta teflón ½″','Gasfitería',270,135,4,10],
    ['SEG-010','Guantes de trabajo','Seguridad',1490,780,55,7],
    ['SEG-011','Gafas de protección','Seguridad',1890,1120,24,4],
    ['CON-012','Pegamento para cerámico 25 kg','Construcción',2890,2100,49,8],
    ['ELE-013','Interruptor simple','Electricidad',780,420,28,5],
  ]
  const clients = ['Cliente general','Constructora Andina','María Torres','Carlos Mendoza','Servicios Norte']
  const items = [[0,1,5],[0,12,4,8],[1,1,13],[4,6,12,0,2],[0,0,1,5,6,12],[4,13,11,2],[0,4,1,12,6]]
  const now = new Date()
  const localDay = new Date(now.getTime() - 5 * 3600000)
  const day = localDay.toISOString().slice(0, 10)
  const today = new Date(day + 'T05:00:00.000Z').getTime()
  const query = (sql, ...args) => db.prepare(sql).bind(...args)
  const queries = [db.prepare("INSERT INTO configuracion VALUES ('demo')")]
  queries.push(query('INSERT INTO proveedores VALUES (1,?,?,?,?),(2,?,?,?,?),(3,?,?,?,?)',
    'Distribuidora Andina','Ana Rojas','andina@example.com','900 000 001',
    'Suministros del Norte','Luis Medina','norte@example.com','900 000 002',
    'Comercial Ferretera Lima','Elena Díaz','lima@example.com','900 000 003'))
  data.forEach(([sku,nombre,categoria,precio,costo,stock,minimo], index) => {
    const id = index + 1
    queries.push(query('INSERT INTO productos VALUES (?,?,?,?,?,?,0,?)', id,sku,nombre,categoria,precio,costo,minimo))
    queries.push(query('INSERT INTO producto_proveedor VALUES (?,?)', id, index % 3 + 1))
    queries.push(query("INSERT INTO movimientos(producto_id,fecha,tipo,cantidad,costo,motivo) VALUES (?,?,'Inicial',?,?,'Inventario de demostración')",
      id, new Date(today - 32 * 86400000).toISOString(), stock, costo))
  })
  let sequence = 0
  items.forEach((dayItems, dayIndex) => dayItems.forEach((product, index) => {
    sequence++
    const dayStart = today - (6 - dayIndex) * 86400000
    const when = new Date(Math.min(now.getTime(), dayStart + (9 + index) * 3600000)).toISOString()
    const quantity = product === 1 ? 5 + index : product === 2 ? 10 : 1 + (index % 2)
    queries.push(query(`INSERT INTO ventas(id,solicitud,fecha,cliente,documento,tipo,pago,usuario_id)
      VALUES (?,?,?,?,?,?,?,${demoSeller})`,
      sequence, 'demo-' + sequence, when, clients[sequence % clients.length], '',
      'Boleta', ['Efectivo','Yape / Plin','Tarjeta'][index % 3]))
    queries.push(query('INSERT INTO partidas VALUES (?,?,?,?,?,?,0)',
      sequence, product + 1, data[product][1], quantity, data[product][3], data[product][4]))
  }))
  // A failure caused by another request initializing the database is recoverable.
  try {
    await db.batch(queries)
  } catch (error) {
    if (!(await db.prepare("SELECT clave FROM configuracion WHERE clave = 'demo'").first())) throw error
  }
}

const moreProducts = [
  ['FIJ-101','Clavos para madera 2″ (kg)','Fijaciones',980,610,36,8],
  ['FIJ-102','Clavos de acero 3″ (kg)','Fijaciones',1470,940,5,8],
  ['FIJ-103','Clavos para concreto 1½″ (caja)','Fijaciones',1150,740,24,6],
  ['FIJ-104','Tarugos de nylon ¼″ (bolsa)','Fijaciones',690,420,32,8],
  ['FIJ-105','Tornillos para madera 1½″ (caja)','Fijaciones',1490,960,25,6],
  ['FIJ-106','Bisagra de acero 3″','Fijaciones',750,460,40,8],
  ['ELE-104','Cinta aislante negra 18 m','Electricidad',540,310,34,6],
  ['ELE-105','Tomacorriente doble 16 A','Electricidad',1750,1060,23,5],
  ['ELE-106','Foco LED 9 W luz fría','Electricidad',990,570,31,8],
  ['CON-104','Yeso de construcción 5 kg','Construcción',1340,930,24,5],
  ['CON-105','Silicona transparente 280 ml','Construcción',1890,1210,22,5],
  ['PLO-106','Codo PVC ½″ de 90°','Gasfitería',250,140,55,12],
  ['PLO-107','Pegamento para PVC ¼ gal','Gasfitería',3390,2180,20,5],
  ['PLO-108','Llave de paso PVC ½″','Gasfitería',899,580,23,5],
  ['HER-108','Flexómetro de 5 m','Herramientas',1990,1230,13,4],
  ['HER-109','Alicate universal de 8″','Herramientas',2990,1890,19,4],
  ['HER-110','Juego de brocas para metal (6 pzas.)','Herramientas',2570,1660,18,4],
  ['HER-111','Serrucho para madera de 18″','Herramientas',3890,2550,15,4],
  ['PIN-109','Rodillo para pintura de 9″','Pinturas',1890,1020,19,5],
  ['PIN-110','Cinta de enmascarar 24 mm','Pinturas',650,360,42,8],
  ['SEG-112','Mascarilla antipolvo (paquete)','Seguridad',1250,710,19,5],
  ['OTR-101','Candado de latón 40 mm','Otros',2480,1490,17,4],
]
const demoBaskets = [
  [['FIJ-101',2],['HER-005',1]],
  [['PLO-106',4],['PLO-107',1]],
  [['ELE-104',2],['ELE-105',1]],
  [['FIJ-101',3],['HER-005',1]],
  [['PLO-106',5],['PLO-107',1]],
  [['ELE-104',1],['ELE-105',2]],
  [['FIJ-101',2],['HER-005',1],['HER-108',1]],
  [['PLO-106',3],['PLO-107',1]],
]

export async function prepararCatalogoAmpliado(db) {
  const marker = 'catalogo-ferreteria'
  const check = q(db,'SELECT clave FROM configuracion WHERE clave=?',marker)
  if (await check.first()) return
  const [products,sale] = await Promise.all([
    all(db,'SELECT sku FROM productos'),
    db.prepare("SELECT 1 operativa FROM ventas WHERE solicitud NOT GLOB 'demo-*' LIMIT 1").first(),
  ])
  const existing = new Set(products.map(product => product.sku.toUpperCase()))
  const demo = !sale
  const queries = [q(db,'INSERT INTO configuracion VALUES (?)',marker)]
  const timestamp = now()
  for (const [sku,name,category,price,cost,stock,minimum] of moreProducts) {
    if (existing.has(sku)) continue
    queries.push(q(db,'INSERT INTO productos(sku,nombre,categoria,precio,costo,minimo) VALUES (?,?,?,?,?,?)',
      sku,name,category,price,cost,minimum))
    if (demo) {
      queries.push(q(db,`INSERT INTO movimientos(producto_id,fecha,tipo,cantidad,costo,motivo)
        SELECT id,?,'Inicial',?,?,'Inventario de demostración' FROM productos WHERE sku=?`,timestamp,stock,cost,sku))
    }
  }
  if (demo) {
    demoBaskets.forEach((items,index) => {
      const request = 'demo-canasta-' + (index + 1)
      queries.push(q(db,`INSERT INTO ventas(solicitud,fecha,cliente,documento,tipo,pago,usuario_id)
        SELECT ?,?,'Cliente de demostración','','Boleta','Efectivo',${demoSeller}
        WHERE NOT EXISTS(SELECT 1 FROM ventas WHERE solicitud NOT GLOB 'demo-*')
          AND (SELECT count(*) FROM productos WHERE ${items.map(() => '(sku=? AND stock>=?)').join(' OR ')})=?`,
        request,timestamp,...items.flat(),items.length))
      for (const [sku,quantity] of items) {
        queries.push(q(db,`INSERT INTO partidas(venta_id,producto_id,nombre,cantidad,precio,costo,descuento)
          SELECT v.id,p.id,p.nombre,?,p.precio,p.costo,0 FROM ventas v CROSS JOIN productos p
          WHERE v.solicitud=? AND p.sku=?`,quantity,request,sku))
      }
    })
  }
  try {
    await db.batch(queries)
  } catch (error) {
    if (!(await check.first())) throw error
  }
}
