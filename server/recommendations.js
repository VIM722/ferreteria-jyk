import { number, q, string } from './http.js'

const dayMs = 86400000
const demoOnly = "(NOT EXISTS (SELECT 1 FROM ventas WHERE solicitud NOT GLOB 'demo-*'))"
const salesWindow = "v.fecha >= ? AND v.fecha <= ? AND (v.solicitud GLOB 'demo-*') = " + demoOnly
const intents = ['ventas','reposicion','promociones']

function requestedTopics(message, previous) {
  const topics = []
  if (/\b(vendi[a-z]*|ventas?|rotacion|demanda|mas vendidos|mas salida|ranking|top)\b/.test(message)) topics.push('ventas')
  if (/\b(repon[a-z]*|reposicion|reabastec[a-z]*|comprar|compras|pedido[s]?|abastec[a-z]*)\b|stock (bajo|minimo)/.test(message)) topics.push('reposicion')
  if (/\b(promoci[a-z]*|ofertas?|combos?|junt[oa]s?|conjunto[s]?|combin[a-z]*|paquetes?)\b/.test(message)) topics.push('promociones')
  if (!topics.length && /\b(resumen|todo|recomendaciones)\b/.test(message)) return intents
  if (!topics.length && /\b(?:y|ahora|para|ultimos|proximos|dias|semanas|meses)\b/.test(message)) return previous
  return topics
}
function parseDays(match) {
  if (!match) return null
  const multiplier = match[2].startsWith('semana') ? 7 : match[2].startsWith('mes') ? 30 : 1
  return Number(match[1]) * multiplier
}
function choosePeriods(message, topics, input) {
  const history = parseDays(message.match(/\b(?:ultim[oa]s?|pasad[oa]s?)\s+(\d{1,3})\s*(dias?|semanas?|mes(?:es)?)/))
    ?? (/\b(?:ultima semana|semana pasada)\b/.test(message) ? 7 : /\b(?:ultimo mes|mes pasado)\b/.test(message) ? 30 : null)
  const future = parseDays(message.match(/\b(?:proxim[oa]s?|siguientes?)\s+(\d{1,3})\s*(dias?|semanas?|mes(?:es)?)/))
    ?? (/\b(?:proxima semana|semana siguiente)\b/.test(message) ? 7 : /\b(?:proximo mes|mes siguiente)\b/.test(message) ? 30 : null)
  const generic = history === null && future === null
    ? parseDays(message.match(/\b(?:en|para|de)\s+(\d{1,3})\s*(dias?|semanas?|mes(?:es)?)/))
    : null
  const onlyRestock = topics.length === 1 && topics[0] === 'reposicion'
  return {
    dias: number(history ?? (onlyRestock ? null : generic) ?? input.dias ?? 30,'El periodo de análisis (1 a 90 días)',1,90),
    horizonte: number(future ?? (onlyRestock ? generic : null) ?? input.horizonte ?? 14,'El horizonte de compra (1 a 60 días)',1,60),
  }
}
function salesResults(rows) {
  const results = rows.filter(row => row.unidades > 0)
    .sort((a,b) => b.unidades - a.unidades || b.importe - a.importe || a.nombre.localeCompare(b.nombre,'es'))
    .slice(0,6)
  return {
    tipo:'ventas',
    titulo:'Productos más vendidos',
    descripcion:results.length
      ? 'Ordenados por unidades vendidas. Los ingresos incluyen los descuentos de cada venta.'
      : 'No hay ventas en el periodo seleccionado. Prueba un rango más amplio.',
    filas:results.map(({id,sku,nombre,unidades,importe}) => ({id,sku,nombre,unidades,importe})),
  }
}
function replenishment(rows, period) {
  const hasSales = rows.some(row => row.unidades > 0)
  const results = rows.map(({id,sku,nombre,stock,minimo,unidades}) => {
    const demanda = Math.ceil(unidades * period.horizonte / period.dias)
    return {id,sku,nombre,stock,minimo,demanda,pedido:Math.max(0,demanda+minimo-stock)}
  }).filter(row => row.pedido > 0)
    .sort((a,b) => Number(b.stock <= b.minimo) - Number(a.stock <= a.minimo) || b.pedido - a.pedido)
    .slice(0,6)
  return {
    tipo:'reposicion',
    titulo:`Compras sugeridas para los próximos ${period.horizonte} días`,
    descripcion:!hasSales && results.length ? 'En este periodo no hay ventas. Las cantidades sugeridas cubren el stock mínimo.'
      : !hasSales ? 'En este periodo no hay ventas ni productos por debajo de su stock mínimo.'
      : results.length
      ? 'La sugerencia suma la demanda estimada y el mínimo de reserva, y resta el stock disponible. La demanda se calcula con el promedio diario del periodo.'
      : 'El stock cubre la demanda estimada y el mínimo de reserva para este horizonte.',
    filas:results,
  }
}
function promotions(rows) {
  const results = rows.map(row => {
    const precioHabitual = row.precio_a + row.precio_b
    const margen = precioHabitual - row.costo_a - row.costo_b
    const stockSuficiente = row.stock_a > row.minimo_a && row.stock_b > row.minimo_b
    const costosConocidos = row.costo_a > 0 && row.costo_b > 0
    const discount = stockSuficiente && costosConocidos ? Math.max(0,Math.floor(Math.min(precioHabitual * 0.05,margen / 2))) : 0
    const accion = !stockSuficiente ? 'Repón el stock antes de lanzar la promoción.'
      : discount > 0 ? 'Prueba un precio de combo por ambos productos.'
      : 'Exhibe ambos productos juntos al precio habitual.'
    return {
      nombre:row.nombre_a + ' + ' + row.nombre_b, juntos:row.juntos,
      referencia:row.ventas_a >= row.ventas_b ? row.nombre_a : row.nombre_b,
      ticketsReferencia:Math.max(row.ventas_a,row.ventas_b),
      accion, precioHabitual, precioCombo:discount > 0 ? precioHabitual - discount : null,
    }
  })
  return {
    tipo:'promociones',
    titulo:'Promociones por compras conjuntas',
    descripcion:results.length
      ? 'Cada combinación aparece en al menos dos comprobantes. Los precios sugeridos consideran el costo registrado y el stock disponible.'
      : 'No hay pares que se repitan en al menos dos comprobantes del periodo. Registra más ventas con varios productos o amplía el rango.',
    filas:results,
  }
}

export async function recommend(db,input) {
  const message = string(input.mensaje,'La consulta',280)
    .normalize('NFD').replace(/\p{M}/gu,'').toLowerCase()
  const previous = Array.isArray(input.temas) ? intents.filter(topic => input.temas.includes(topic)) : []
  const topics = requestedTopics(message,previous)
  if (!topics.length) {
    return { mensaje:'Puedo revisar tus productos más vendidos, calcular qué conviene reponer o buscar productos que se compran juntos. ¿Qué quieres consultar?',bloques:[],temas:previous }
  }

  const period = choosePeriods(message,topics,input)
  const end = new Date()
  const today = new Date(end.getTime() - 5 * 3600000).toISOString().slice(0,10)
  const start = new Date(Date.parse(today + 'T05:00:00.000Z') - (period.dias - 1) * dayMs).toISOString()
  const dates = [start,end.toISOString()]
  const queries = [q(db,`SELECT ${demoOnly} demo,(SELECT count(*) FROM ventas v WHERE ${salesWindow}) comprobantes`,...dates)]
  const products = topics.includes('ventas') || topics.includes('reposicion')
  if (products) {
    queries.push(q(db,`SELECT p.id,p.sku,p.nombre,p.stock,p.minimo,coalesce(r.unidades,0) unidades,coalesce(r.importe,0) importe
      FROM productos p LEFT JOIN (
        SELECT i.producto_id,sum(i.cantidad) unidades,sum(i.precio*i.cantidad-i.descuento) importe
        FROM ventas v JOIN partidas i ON i.venta_id=v.id WHERE ${salesWindow} GROUP BY i.producto_id
      ) r ON r.producto_id=p.id`,...dates))
  }
  if (topics.includes('promociones')) {
    queries.push(q(db,`WITH lineas AS (
      SELECT i.venta_id,i.producto_id FROM ventas v JOIN partidas i ON i.venta_id=v.id WHERE ${salesWindow}
    ), frecuencia AS (
      SELECT producto_id,count(*) cantidad FROM lineas GROUP BY producto_id
    ), pares AS (
      SELECT a.producto_id a_id,b.producto_id b_id,count(*) juntos
      FROM lineas a JOIN lineas b ON a.venta_id=b.venta_id AND a.producto_id<b.producto_id
      GROUP BY a.producto_id,b.producto_id HAVING count(*)>=2
    )
    SELECT pares.juntos,fa.cantidad ventas_a,fb.cantidad ventas_b,
      a.nombre nombre_a,a.stock stock_a,a.minimo minimo_a,a.precio precio_a,a.costo costo_a,
      b.nombre nombre_b,b.stock stock_b,b.minimo minimo_b,b.precio precio_b,b.costo costo_b
    FROM pares JOIN productos a ON a.id=pares.a_id JOIN productos b ON b.id=pares.b_id
      JOIN frecuencia fa ON fa.producto_id=a.id JOIN frecuencia fb ON fb.producto_id=b.id
    ORDER BY (a.stock>a.minimo AND b.stock>b.minimo) DESC,pares.juntos DESC,
      1.0*pares.juntos/max(fa.cantidad,fb.cantidad) DESC, a.nombre,b.nombre LIMIT 5`,...dates))
  }
  const [summary, ...datasets] = (await db.batch(queries)).map(result => result.results)
  const productRows = products ? datasets.shift() : []
  const bloques = []
  if (topics.includes('ventas')) bloques.push(salesResults(productRows))
  if (topics.includes('reposicion')) bloques.push(replenishment(productRows,period))
  if (topics.includes('promociones')) bloques.push(promotions(datasets[0]))
  return {
    mensaje:'Este es el análisis para el periodo consultado.',
    periodo:{ ...period,desde:start.slice(0,10),hasta:today,comprobantes:summary[0].comprobantes,demo:Boolean(summary[0].demo) },
    temas:topics,bloques,
  }
}
