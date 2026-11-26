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
    queries.push(query('INSERT INTO ventas(id,solicitud,fecha,cliente,documento,tipo,pago) VALUES (?,?,?,?,?,?,?)',
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
