const main = document.querySelector('#main')
const modal = document.querySelector('#modal')
const appShell = document.querySelector('#app-shell')
const loginScreen = document.querySelector('#login-screen')
const loginForm = document.querySelector('#login-form')
const loginStatus = document.querySelector('#login-status')
const loginError = document.querySelector('#login-error')
const state = {
  page: 'panel', sub: '', dias: 7, catalog: null, panel: null, cart: new Map(), receipt: {},
  saleToken: null, submittingSale: false, salesPage: 1, salesFilters: {}, viewLoad: 0, user: null, accounts: [],
}
const titles = { panel: 'Panel general', ventas: 'Ventas', inventario: 'Inventario', proveedores: 'Proveedores', reportes: 'Reportes', usuarios: 'Usuarios', actividad: 'Actividad' }
const roles = { vendedor: 'Vendedor', almacenero: 'Almacenero', dueno: 'Dueño', administrador: 'Administrador' }
const pageGrants = { panel:['reportes'], ventas:['ventas'], inventario:['inventario','catalogo'], proveedores:['proveedores'], reportes:['reportes'], usuarios:['usuarios'], actividad:['actividad'] }
const has = permission => state.user?.permisos.includes(permission) ?? false
const canOpen = page => pageGrants[page]?.some(has) ?? false
const homePage = () => canOpen('panel') ? 'panel' : canOpen('ventas') ? 'ventas' : 'inventario'
const categoryIcons = { Herramientas: 'hammer', Construcción: 'box', Electricidad: 'bolt', Gasfitería: 'drop', Pinturas: 'brush', Fijaciones: 'hammer', Seguridad: 'shield' }
const colors = { Herramientas: '', Construcción: 'amber', Electricidad: 'blue', Gasfitería: 'blue', Pinturas: 'pink', Fijaciones: 'amber', Seguridad: 'green' }
const methods = ['Efectivo', 'Tarjeta', 'Yape / Plin', 'Transferencia']
const html = value => String(value ?? '').replace(/[&<>"']/g, x => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[x])
const nf = new Intl.NumberFormat('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const money = cents => 'S/ ' + nf.format(cents / 100)
const currencyInput = cents => (cents / 100).toFixed(2)
const localDate = new Intl.DateTimeFormat('es-PE', { dateStyle: 'medium', timeZone: 'America/Lima' })
const localDateTime = new Intl.DateTimeFormat('es-PE', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Lima' })
const longDate = new Intl.DateTimeFormat('es-PE', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/Lima' })
const dayFormatter = new Intl.DateTimeFormat('es-PE', { weekday: 'short', timeZone: 'UTC' })
const invoice = item => (item.tipo === 'Factura' ? 'F001-' : 'B001-') + String(item.id).padStart(5, '0')
const icon = name => `<svg aria-hidden="true"><use href="#i-${name}"/></svg>`
const tile = (name, color = '') => `<span class="icon-tile ${color}">${icon(name)}</span>`
const productTile = category => tile(categoryIcons[category] || 'box', colors[category] || '')
const btn = (label, action, symbol, variant = 'secondary', extra = '') => `<button type="button" class="btn ${variant}" data-action="${action}" ${extra}>${symbol ? icon(symbol) : ''}${label}</button>`
const selectOptions = (items, current) => items.map(item => `<option value="${html(item)}"${item === current ? ' selected' : ''}>${html(item)}</option>`).join('')
const empty = msg => `<p class="empty">${html(msg)}</p>`
let chartResize
let timer

async function api(path, method = 'GET', body) {
  const viewer = state.user
  const response = await fetch('/api/' + path, {
    method, ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
  })
  let data
  try {
    data = await response.json()
  } catch {
    throw new Error('No se pudo conectar con la base de datos.')
  }
  if (!response.ok) {
    const error = new Error(data.error || 'No se pudo completar la operación.')
    error.status = response.status
    if (response.status === 401 && viewer && state.user === viewer && path !== 'login') {
      showLogin('Tu sesión terminó. Ingresa de nuevo.')
    }
    throw error
  }
  return data
}
function showLogin(message = '') {
  state.viewLoad++
  state.user = null
  state.catalog = null
  state.panel = null
  state.accounts = []
  state.receipt = {}
  state.cart.clear()
  state.saleToken = null
  state.salesFilters = {}
  state.salesPage = 1
  state.dias = 7
  chartResize?.disconnect()
  if (modal.open) modal.close()
  modal.replaceChildren()
  main.replaceChildren()
  appShell.hidden = true
  loginScreen.hidden = false
  loginStatus.hidden = true
  loginError.textContent = message
  loginError.hidden = !message
  loginForm.reset()
  loginForm.elements.clave.type = 'password'
  const toggle = loginForm.querySelector('[data-action="ver-clave"]')
  toggle.setAttribute('aria-pressed','false')
  toggle.setAttribute('aria-label','Mostrar contraseña')
  loginForm.querySelector('[type="submit"]').disabled = false
  loginForm.elements.usuario.focus()
}
async function enter(user, preserveRoute = false) {
  state.user = user
  const letters = user.nombre.split(/\s+/).slice(0,2).map(word => word[0]).join('').toUpperCase()
  document.querySelector('#profile-name').textContent = user.nombre
  document.querySelector('#profile-role').textContent = roles[user.rol]
  document.querySelector('#profile-initials').textContent = letters
  document.querySelector('#sidebar-initials').textContent = letters
  document.querySelector('#home-link').href = '#' + homePage()
  document.querySelectorAll('.nav-group').forEach(group => {
    group.querySelectorAll('a').forEach(link => { link.hidden = !canOpen(link.hash.slice(1)) })
    group.hidden = !group.querySelector('a:not([hidden])')
  })
  document.querySelector('.bell-button').hidden = !canOpen('inventario')
  document.querySelector('#alert-dot').hidden = true
  if (!preserveRoute || !location.hash) historyNavigation('#' + homePage())
  main.innerHTML = empty('Cargando tu espacio de trabajo…')
  loginForm.reset()
  loginScreen.hidden = true
  appShell.hidden = false
  await render()
}
async function initialize() {
  try {
    const user = await api('sesion')
    await enter(user,true)
  } catch (error) {
    showLogin(error.status === 401 ? '' : error.message)
  }
}
function notify(message) {
  const toast = document.querySelector('#toast')
  toast.textContent = message
  toast.hidden = false
  clearTimeout(timer)
  timer = setTimeout(() => { toast.hidden = true }, 4500)
}
function pageHead(title, sub, actions = '') {
  return `<div class="page-head"><div><h1>${title}</h1><p>${sub}</p></div>${actions ? `<div class="page-actions">${actions}</div>` : ''}</div>`
}
function cardHead(title, sub = '', right = '') {
  return `<div class="card-head"><div><h2>${title}</h2>${sub ? `<p>${sub}</p>` : ''}</div>${right}</div>`
}
function table(columns, rows, message = 'No hay registros para mostrar.') {
  if (!rows.length) return empty(message)
  return `<div class="table-wrap" tabindex="0" role="region" aria-label="Tabla de resultados"><table><thead><tr>${columns.map(c => `<th scope="col">${c}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`
}
function period() {
  return `<select id="periodo" aria-label="Periodo del reporte">${[7,30].map(n => `<option value="${n}"${state.dias === n ? ' selected' : ''}>Últimos ${n} días</option>`).join('')}</select>`
}
function stat(label, value, symbol, color, note) {
  return `<div class="stat"><div class="stat-top">${tile(symbol,color)}<span>${label}</span></div><strong>${value}</strong><p class="stat-note">${note}</p></div>`
}
function compare(value, previous) {
  if (!previous) return `En los últimos ${state.dias} días`
  const percentage = Math.round((value - previous) / previous * 100)
  return `<b class="${percentage < 0 ? 'negative' : ''}">${percentage > 0 ? '+' : ''}${percentage}%</b> vs. periodo anterior`
}
function indicators(data) {
  return `<section class="stats" aria-label="Indicadores">
    ${stat('Ventas del periodo', money(data.total), 'coin', '', compare(data.total,data.anterior.total))}
    ${stat('Ventas registradas', data.ventas, 'receipt', 'green', compare(data.ventas,data.anterior.cantidad))}
    ${stat('Productos activos', data.inventario.productos, 'box', 'blue', 'En el catálogo')}
    ${stat('Stock bajo', data.inventario.alertas, 'warning', 'amber', 'Productos por reponer')}
  </section>`
}
function chartCard() {
  return `<section class="card">
    ${cardHead('Rendimiento de ventas','Ingresos diarios en soles',period())}
    <div class="chart-wrap"><canvas id="chart" role="img" aria-label="Gráfico de ingresos diarios"></canvas></div>
  </section>`
}
function stockAlerts(items) {
  return `<section class="card">
    ${cardHead('Alertas de stock','Productos que requieren reposición',tile('warning','amber'))}
    ${items.length ? `<ul class="alerts-list">${items.slice(0,3).map(p => `<li>${productTile(p.categoria)}<span class="item-name"><b>${html(p.nombre)}</b><small>${html(p.sku)} · Mín. ${p.minimo}</small></span><span class="badge ${p.stock === 0 ? 'danger' : 'warning'}">${p.stock} unid.</span></li>`).join('')}</ul>` : empty('Todos los productos tienen stock suficiente.')}
    <div class="alert-foot"><a href="#inventario/alertas" class="btn quiet">Ver inventario</a></div>
  </section>`
}
function salesTable(items) {
  return table(['Comprobante','Cliente','Fecha','Medio de pago','Total','Detalle'], items.map(s => `<tr>
    <td><strong>${invoice(s)}</strong></td><td>${html(s.cliente)}</td><td>${localDate.format(new Date(s.fecha))}</td>
    <td><span class="badge neutral">${html(s.pago)}</span></td><td><strong>${money(s.total)}</strong></td>
    <td><button class="text-btn" type="button" data-action="comprobante" data-id="${s.id}">Ver</button></td>
  </tr>`), 'No se encontraron ventas.')
}
function dashboard(data) {
  return `${pageHead('Panel general','Consulta tus ventas y el estado del inventario.',`<span class="date-chip">${icon('calendar')}${longDate.format(new Date())}</span>`)}
    <section class="hero">
      <div class="hero-copy">
        <h2>Ferretería JyK</h2>
        <p>Registra ventas y consulta las existencias<br> de tu ferretería en un solo lugar.</p>
        ${has('ventas') ? `<a href="#ventas" class="btn">${icon('plus')} Nueva venta</a>`
          : `<a href="#reportes" class="btn">${icon('chart')} Ver reportes</a>`}
      </div>
    </section>
    ${indicators(data)}
    <div class="split">${chartCard()}${stockAlerts(data.alertas)}</div>
    ${has('ventas') ? `<section class="card">${cardHead('Ventas recientes','',`<a class="text-btn" href="#ventas/historial">Ver historial</a>`)}${salesTable(data.recientes)}</section>` : ''}`
}
function drawChart(series) {
  const canvas = document.querySelector('#chart')
  if (!canvas) return
  canvas.setAttribute('aria-label', series.map(row => row.dia + ': ' + money(row.total)).join(', '))
  chartResize?.disconnect()
  const draw = () => {
    const width = canvas.clientWidth
    const height = canvas.clientHeight
    if (!width || !height) return
    const density = Math.min(devicePixelRatio || 1, 2)
    canvas.width = width * density
    canvas.height = height * density
    const ctx = canvas.getContext('2d')
    ctx.scale(density,density)
    const left = width < 380 ? 43 : 52
    const right = width - 15
    const top = 10
    const bottom = height - 25
    const max = Math.ceil(Math.max(20000, ...series.map(row => row.total)) / 20000) * 20000
    const y = cents => bottom - cents / max * (bottom - top)
    const x = index => left + index * (right - left) / (series.length - 1)
    ctx.font = '11px Segoe UI, system-ui, sans-serif'
    ctx.textBaseline = 'middle'
    for (let i = 0; i <= 4; i++) {
      const value = Math.round(max * i / 4)
      ctx.strokeStyle = '#eeebf4'
      ctx.beginPath()
      ctx.moveTo(left, y(value))
      ctx.lineTo(right, y(value))
      ctx.stroke()
      ctx.fillStyle = '#6d667e'
      ctx.textAlign = 'right'
      ctx.fillText('S/ ' + (value / 100).toLocaleString('es-PE'), left - 8, y(value))
    }
    const dots = series.map((row,i) => [x(i), y(row.total)])
    function line() {
      ctx.moveTo(...dots[0])
      for (let i = 1; i < dots.length; i++) {
        const [previousX, previousY] = dots[i - 1]
        const [nextX,nextY] = dots[i]
        const mid = (previousX + nextX) / 2
        ctx.bezierCurveTo(mid,previousY,mid,nextY,nextX,nextY)
      }
    }
    const gradient = ctx.createLinearGradient(0,top,0,bottom)
    gradient.addColorStop(0,'#9161f04a')
    gradient.addColorStop(1,'#a576ff04')
    ctx.fillStyle = gradient
    ctx.beginPath()
    line()
    ctx.lineTo(right,bottom)
    ctx.lineTo(left,bottom)
    ctx.closePath()
    ctx.fill()
    ctx.strokeStyle = '#8050e2'
    ctx.lineWidth = 2.6
    ctx.beginPath()
    line()
    ctx.stroke()
    const labelStep = series.length > 7 ? 5 : 1
    dots.forEach(([px,py], i) => {
      if (series.length <= 7 || series[i].total > 0) {
        ctx.beginPath()
        ctx.fillStyle = '#fff'
        ctx.arc(px,py,3.2,0,Math.PI*2)
        ctx.fill()
        ctx.lineWidth = 1.7
        ctx.stroke()
      }
      if (i % labelStep === 0 || i === series.length - 1) {
        const date = new Date(series[i].dia + 'T12:00:00Z')
        const text = series.length > 7 ? date.getUTCDate() + '/' + (date.getUTCMonth() + 1) : dayFormatter.format(date).replace('.', '')
        ctx.fillStyle = '#6d667e'
        ctx.textAlign = i === series.length - 1 ? 'right' : 'center'
        ctx.fillText(text,px,height - 7)
      }
    })
  }
  chartResize = new ResizeObserver(draw)
  chartResize.observe(canvas)
  draw()
}
function tabs(kind, items) {
  return `<nav class="tabs" aria-label="Opciones de ${kind}">${items.map(([path,label]) => `<a href="#${kind}${path ? '/' + path : ''}"${path === state.sub ? ' aria-current="page"' : ''}>${label}</a>`).join('')}</nav>`
}
function inventoryRows() {
  const filter = document.querySelector('#inventory-search')?.value.toLowerCase().trim() || ''
  const category = document.querySelector('#inventory-category')?.value || ''
  const products = state.catalog.productos.filter(p => (p.nombre + ' ' + p.sku).toLowerCase().includes(filter)
    && (!category || p.categoria === category) && (state.sub !== 'alertas' || p.stock <= p.minimo))
  const edit = has('catalogo')
  const columns = ['Producto','Categoría',edit ? 'Precio' : 'Costo promedio','Stock','Mínimo','Estado']
  if (edit) columns.push('Acciones')
  return table(columns, products.map(p => `<tr>
    <td><div class="item-name">${productTile(p.categoria)}<span><b>${html(p.nombre)}</b><small>${html(p.sku)}</small></span></div></td>
    <td>${html(p.categoria)}</td><td>${money(edit ? p.precio : p.costo)}</td><td><strong>${p.stock}</strong></td><td>${p.minimo}</td>
    <td><span class="badge ${p.stock === 0 ? 'danger' : p.stock <= p.minimo ? 'warning' : ''}">${p.stock === 0 ? 'Agotado' : p.stock <= p.minimo ? 'Stock bajo' : 'Disponible'}</span></td>
    ${edit ? `<td class="row-action">${btn('Editar','producto','edit','secondary',`data-id="${p.id}"`)}</td>` : ''}
  </tr>`), 'No se encontraron productos.')
}
function inventory() {
  const categories = selectOptions(state.catalog.categorias)
  const changeStock = has('inventario')
  const edit = has('catalogo')
  return `${pageHead('Inventario',changeStock ? 'Consulta existencias y registra ingresos y bajas.' : 'Administra el catálogo y consulta las existencias.',
    (changeStock ? btn('Ingreso / Baja','movimiento','swap',edit ? 'secondary' : 'primary') : '') + (edit ? btn('Nuevo producto','producto','plus','primary') : ''))}
    ${tabs('inventario',[['','Catálogo'],['alertas','Stock bajo'],...(changeStock ? [['movimientos','Movimientos']] : [])])}
    <section class="card">
      ${cardHead(state.sub === 'alertas' ? 'Productos por reponer' : 'Catálogo de productos')}
      <div class="toolbar"><input id="inventory-search" type="search" placeholder="Buscar por nombre o SKU" aria-label="Buscar por nombre o SKU"><select id="inventory-category" aria-label="Categoría"><option value="">Todas las categorías</option>${categories}</select></div>
      <div id="inventory-rows">${inventoryRows()}</div>
    </section>`
}
function movements(items) {
  return `${pageHead('Inventario','Consulta los últimos 100 movimientos.',btn('Ingreso / Baja','movimiento','swap','primary'))}
    ${tabs('inventario',[['','Catálogo'],['alertas','Stock bajo'],['movimientos','Movimientos']])}
    <section class="card">${cardHead('Movimientos de inventario')}
      ${table(['Fecha','Producto','Movimiento','Unidades','Proveedor','Motivo'],items.map(m => `<tr><td>${localDateTime.format(new Date(m.fecha))}</td>
        <td><div class="item-name"><span><b>${html(m.nombre)}</b><small>${html(m.sku)}</small></span></div></td>
        <td><span class="badge ${m.cantidad > 0 ? '' : 'neutral'}">${html(m.tipo)}</span></td>
        <td>${m.cantidad > 0 ? '+' : ''}${m.cantidad}</td><td>${html(m.proveedor || '—')}</td><td>${html(m.motivo)}</td></tr>`))}
    </section>`
}
function suppliers() {
  const { proveedores, enlaces } = state.catalog
  return `${pageHead('Proveedores','Gestiona tus contactos y los productos que suministran.',btn('Nuevo proveedor','proveedor','plus','primary'))}
    <section class="card">${cardHead('Directorio de proveedores')}
    ${table(['Proveedor','Contacto','Correo','Teléfono','Productos','Acciones'],proveedores.map(p => `<tr>
      <td><div class="item-name">${tile('truck')}<b>${html(p.nombre)}</b></div></td>
      <td>${html(p.contacto || '—')}</td><td>${html(p.correo || '—')}</td><td>${html(p.telefono || '—')}</td>
      <td><span class="badge neutral">${enlaces.filter(e => e.proveedor_id === p.id).length} asociados</span></td>
      <td class="row-action">${btn('Editar','proveedor','edit','secondary',`data-id="${p.id}"`)}</td>
    </tr>`))}</section>`
}
function userPage(accounts) {
  return `${pageHead('Usuarios','Administra las cuentas y su acceso a la ferretería.',btn('Nuevo usuario','usuario','plus','primary'))}
    <section class="card">${cardHead('Cuentas del sistema')}
      ${table(['Nombre','Usuario','Rol','Estado','Acciones'],accounts.map(account => `<tr>
        <td><div class="item-name">${tile('users')}<b>${html(account.nombre)}</b></div></td>
        <td>${html(account.usuario)}${account.id === state.user.id ? ' (tú)' : ''}</td>
        <td><span class="badge neutral">${roles[account.rol]}</span></td>
        <td><span class="badge ${account.activo ? '' : 'danger'}">${account.activo ? 'Activo' : 'Inactivo'}</span></td>
        <td class="row-action">${btn('Editar','usuario','edit','secondary',`data-id="${account.id}" aria-label="Editar a ${html(account.nombre)}"`)}</td>
      </tr>`))}
    </section>`
}
function activityPage(entries) {
  return `${pageHead('Actividad','Consulta los últimos 100 registros del sistema.')}
    <section class="card">${cardHead('Registro de actividad')}
    ${table(['Fecha','Cuenta','Acción','Detalle'],entries.map(entry => `<tr>
      <td>${localDateTime.format(new Date(entry.fecha))}</td><td><div class="item-name"><span><b>${html(entry.nombre)}</b><small>${html(entry.usuario)}</small></span></div></td>
      <td><span class="badge neutral">${html(entry.accion)}</span></td><td>${html(entry.detalle || '—')}</td>
    </tr>`),'Todavía no hay actividad registrada.')}</section>`
}
function report(data) {
  const rotation = data.rotacion
  const headers = ['Producto','Unidades vendidas']
  const rows = list => list.map(p => `<tr><td><div class="item-name">${productTile(p.categoria)}<span><b>${html(p.nombre)}</b><small>${html(p.sku)}</small></span></div></td><td><strong>${p.unidades}</strong></td></tr>`)
  const margin = data.total ? Math.round(data.margen / data.total * 100) + '% de las ventas' : 'Sin ventas en el periodo'
  return `${pageHead('Reportes','Consulta ingresos, margen bruto y rotación de productos.')}
    <div class="stats">${stat('Ingresos',money(data.total),'coin','',compare(data.total,data.anterior.total))}
      ${stat('Utilidad bruta estimada',money(data.margen),'trend','green',margin)}
      ${stat('Valor del inventario',money(data.inventario.valor),'box','blue','Al costo promedio')}
      ${stat('Ventas registradas',data.ventas,'receipt','amber',compare(data.ventas,data.anterior.cantidad))}
    </div>
    <div class="split">${chartCard()}${stockAlerts(data.alertas)}</div>
    <div class="split"><section class="card">${cardHead('Mayor rotación')}${table(headers,rows(rotation.filter(item => item.unidades > 0).slice(0,5)))}</section>
      <section class="card">${cardHead('Menor rotación','Incluye productos sin ventas en el periodo')}${table(headers,rows([...rotation].reverse().slice(0,5)))}</section>
    </div>`
}
function foundProducts(filter) {
  const value = filter.toLowerCase().trim()
  return state.catalog.productos.filter(p => (p.nombre + ' ' + p.sku).toLowerCase().includes(value))
}
function productList(filter = '', mode = 'sale') {
  const products = foundProducts(filter)
  if (!products.length) return empty('No se encontraron productos.')
  return `<ul class="products-list">${products.map(p => `<li>
    ${productTile(p.categoria)}<span class="item-name"><b>${html(p.nombre)}</b><small>${html(p.sku)} · ${p.stock} disponibles</small></span>
    ${typeof p.precio === 'number' ? `<strong>${money(p.precio)}</strong>` : ''}
    ${mode === 'sale' ? `<button type="button" class="icon-btn" data-action="agregar" data-id="${p.id}" aria-label="Agregar ${html(p.nombre)}" ${p.stock <= (state.cart.get(p.id)?.cantidad || 0) ? 'disabled' : ''}>${icon('plus')}</button>` :
      btn('Ver producto','buscar-resultado',null,'secondary',`data-id="${p.id}"`)}
  </li>`).join('')}</ul>`
}
function cart() {
  const items = [...state.cart.values()]
  const totals = items.reduce((sum,p) => sum + p.precio * p.cantidad - p.descuento, 0)
  return `${cardHead('Carrito',items.length + (items.length === 1 ? ' producto' : ' productos'))}
    ${items.length ? `<ul class="cart-list">${items.map(p => `<li><span class="item-name"><b>${html(p.nombre)}</b><small>${money(p.precio)} por unidad</small></span>
      <span class="counter">
        <button type="button" class="icon-btn" data-action="restar" data-id="${p.id}" aria-label="Restar una unidad de ${html(p.nombre)}">${icon('minus')}</button>
        <b>${p.cantidad}</b>
        <button type="button" class="icon-btn" data-action="agregar" data-id="${p.id}" aria-label="Sumar una unidad de ${html(p.nombre)}" ${p.cantidad >= p.stock ? 'disabled' : ''}>${icon('plus')}</button>
        <button type="button" class="icon-btn" data-action="quitar" data-id="${p.id}" aria-label="Quitar ${html(p.nombre)}">${icon('x')}</button>
      </span>
      <label class="discount">Descuento S/ <input type="number" min="0" max="${currencyInput(p.precio*p.cantidad)}" step=".01" data-discount="${p.id}" value="${currencyInput(p.descuento)}" aria-label="Descuento de ${html(p.nombre)}"></label>
    </li>`).join('')}</ul>` : empty('Agrega productos para comenzar la venta.')}
    <div class="cart-summary"><div class="total-row"><span>Total</span><span>${money(totals)}</span></div>
      ${btn('Revisar y cobrar','cobrar','check','primary full',items.length ? '' : 'disabled')}</div>`
}
function checkout() {
  return `${pageHead('Nueva venta','Busca productos y registra el pago del cliente.')}
    ${tabs('ventas',[['','Nueva venta'],['historial','Historial']])}
    <div class="checkout"><section class="card">
      ${cardHead('Productos','Consulta la disponibilidad antes de cobrar.')}
      <div class="toolbar"><input type="search" id="sale-search" placeholder="Buscar por nombre o SKU" aria-label="Buscar productos para vender" class="full"></div>
      <div id="sale-products" class="product-picker">${productList()}</div>
    </section><section class="card" id="cart">${cart()}</section></div>`
}
function history(result) {
  return `${pageHead('Historial de ventas','Filtra por fecha, cliente o número de comprobante.',`<a class="btn primary" href="#ventas">${icon('plus')} Nueva venta</a>`)}
    ${tabs('ventas',[['','Nueva venta'],['historial','Historial']])}
    <section class="card">${cardHead('Ventas registradas')}
      <form id="sales-filters" class="toolbar">
        <input name="cliente" type="search" aria-label="Cliente o comprobante" placeholder="Cliente o comprobante" value="${html(state.salesFilters.cliente)}">
        <label>Desde <input name="desde" type="date" value="${html(state.salesFilters.desde)}"></label>
        <label>Hasta <input name="hasta" type="date" value="${html(state.salesFilters.hasta)}"></label>
        <button class="btn secondary" type="submit">Filtrar</button>
      </form>
      ${salesTable(result.filas)}
      <div class="pagination"><span>${result.total} ventas</span><div class="actions">
        ${btn('Anterior','anterior',null,'secondary',state.salesPage <= 1 ? 'disabled' : '')}
        <span>Pág. ${state.salesPage}</span>
        ${btn('Siguiente','siguiente',null,'secondary',result.total <= state.salesPage * 25 ? 'disabled' : '')}
      </div></div>
    </section>`
}
function refreshCart(focus) {
  if (!document.querySelector('#cart')) return
  document.querySelector('#cart').innerHTML = cart()
  const input = document.querySelector('#sale-search')
  document.querySelector('#sale-products').innerHTML = productList(input.value)
  if (focus?.id) {
    const candidate = [...main.querySelectorAll('[data-action][data-id]')].find(item => item.dataset.action === focus.action && item.dataset.id === focus.id && !item.disabled)
    const nextFocus = candidate || input
    nextFocus.focus({ preventScroll: true })
  }
}
function changeCart(action, id, source) {
  const product = state.catalog.productos.find(p => p.id === id)
  if (!product) return
  const entry = state.cart.get(id) || { ...product, cantidad: 0, descuento: 0 }
  if (action === 'quitar' || (action === 'restar' && entry.cantidad === 1)) {
    state.cart.delete(id)
  } else {
    const quantity = entry.cantidad + (action === 'agregar' ? 1 : -1)
    if (quantity > product.stock) return notify('No hay más unidades disponibles.')
    if (!state.cart.has(id) && state.cart.size >= 30) return notify('Puedes agregar hasta 30 productos por venta.')
    entry.cantidad = quantity
    entry.descuento = Math.min(entry.descuento,entry.precio*quantity)
    state.cart.set(id, entry)
  }
  state.saleToken = null
  refreshCart(source.dataset)
}
function openDialog(title, content) {
  modal.innerHTML = `<div class="modal-title"><h2 id="dialog-title">${title}</h2><button type="button" class="icon-btn" data-action="cerrar" aria-label="Cerrar">${icon('x')}</button></div>${content}`
  if (!modal.open) modal.showModal()
}
function form(id, fields, label = 'Guardar') {
  return `<form id="${id}" class="form-body"><div class="group">${fields}</div>
    <p class="form-error" role="alert" hidden></p><div class="modal-actions">${btn('Cancelar','cerrar')}<button class="btn primary" type="submit">${label}</button></div>
  </form>`
}
const field = (label, content, wide = false) => `<label class="field ${wide ? 'wide' : ''}">${label}${content}</label>`
function input(name, value = '', attributes = '') {
  return `<input name="${name}" value="${html(value)}" ${attributes}>`
}
function checkList(items, selected, name, label) {
  return `<div class="field wide"><span>${label}</span><div class="checks">${items.length ? items.map(item => `<label><input type="checkbox" name="${name}" value="${item.id}"${selected.includes(item.id) ? ' checked' : ''}> ${html(item.nombre)}</label>`).join('') : 'Sin registros disponibles'}</div></div>`
}
function productDialog(id) {
  const { productos, proveedores, enlaces, categorias } = state.catalog
  const product = productos.find(p => p.id === id)
  const selected = enlaces.filter(e => e.producto_id === id).map(e => e.proveedor_id)
  openDialog(product ? 'Editar producto' : 'Nuevo producto', form('product-form',
    input('id',id || '', 'type="hidden"')
    + field('Nombre',input('nombre',product?.nombre,'required maxlength="100" autofocus'),true)
    + field('SKU',input('sku',product?.sku,'required maxlength="32"'))
    + field('Categoría',`<select name="categoria">${selectOptions(categorias,product?.categoria)}</select>`)
    + field('Precio de venta (S/)',input('precio',product ? currencyInput(product.precio) : '', 'type="number" min=".01" max="100000" step=".01" required'))
    + field('Stock mínimo',input('minimo',product?.minimo ?? 5,'type="number" min="0" max="100000" step="1" required'))
    + (product ? '' : field('Costo inicial (S/)',input('costo','','type="number" min="0" max="100000" step=".01" required'))
      + field('Stock inicial',input('stock','0','type="number" min="0" max="100000" step="1" required')))
    + checkList(proveedores,selected,'proveedores','Proveedores asociados')))
}
function supplierDialog(id) {
  const { productos, proveedores, enlaces } = state.catalog
  const supplier = proveedores.find(p => p.id === id)
  const selected = enlaces.filter(e => e.proveedor_id === id).map(e => e.producto_id)
  openDialog(supplier ? 'Editar proveedor' : 'Nuevo proveedor', form('supplier-form',
    input('id',id || '', 'type="hidden"')
    + field('Nombre de la empresa',input('nombre',supplier?.nombre,'required maxlength="100" autofocus'),true)
    + field('Persona de contacto',input('contacto',supplier?.contacto,'maxlength="100"'),true)
    + field('Correo',input('correo',supplier?.correo,'type="email" maxlength="120"'))
    + field('Teléfono',input('telefono',supplier?.telefono,'type="tel" maxlength="30"'))
    + checkList(productos,selected,'productos','Productos que suministra')))
}
function userDialog(id) {
  const account = state.accounts.find(item => item.id === id)
  const isSelf = account?.id === state.user.id
  openDialog(account ? 'Editar usuario' : 'Nuevo usuario',form('user-form',
    input('id',account?.id || '', 'type="hidden"')
    + field('Nombre',input('nombre',account?.nombre,'required maxlength="100" autofocus'),true)
    + field('Usuario',input('usuario',account?.usuario,'required minlength="3" maxlength="32" autocomplete="off" autocapitalize="none" pattern="[a-zA-Z0-9._\\-]{3,32}"'))
    + field('Rol',`<select name="rol" ${isSelf ? 'disabled' : ''}>${Object.entries(roles).map(([value,label]) =>
      `<option value="${value}"${value === account?.rol ? ' selected' : ''}>${label}</option>`).join('')}</select>`)
    + field(account ? 'Nueva contraseña (opcional)' : 'Contraseña',
      input('clave','',`type="password" autocomplete="new-password" minlength="12" maxlength="128" placeholder="Mínimo 12 caracteres" ${account ? '' : 'required'}`),true)
    + field('Estado',`<select name="activo" ${isSelf ? 'disabled' : ''}><option value="1">Activo</option><option value="0"${account?.activo === 0 ? ' selected' : ''}>Inactivo</option></select>`)))
}
function movementDialog(id) {
  const { productos, proveedores } = state.catalog
  if (!productos.length) return notify('Primero registra un producto en el catálogo.')
  openDialog('Movimiento de inventario',form('movement-form',
    field('Producto',`<select name="id" required>${productos.map(p => `<option value="${p.id}"${p.id === id ? ' selected' : ''}>${html(p.nombre)} (${p.stock} disponibles)</option>`).join('')}</select>`,true)
    + field('Tipo de movimiento',`<select name="tipo" id="movement-kind"><option>Ingreso</option><option>Baja</option></select>`)
    + field('Unidades',input('cantidad','1','type="number" min="1" max="100000" step="1" required'))
    + `<div class="field wide" id="movement-detail"></div>`, 'Registrar movimiento'))
  movementFields()
}
function movementFields() {
  const detail = document.querySelector('#movement-detail')
  const type = document.querySelector('#movement-kind').value
  detail.innerHTML = type === 'Ingreso'
    ? field('Proveedor',`<select name="proveedor" required><option value="">Selecciona un proveedor</option>${state.catalog.proveedores.map(s => `<option value="${s.id}">${html(s.nombre)}</option>`).join('')}</select>`)
      + field('Costo unitario (S/)',input('costo','','type="number" min="0" max="100000" step=".01" required'))
    : field('Motivo de la baja',input('motivo','','required maxlength="160" placeholder="Ej. deterioro, vencimiento o pérdida"'))
}
function paymentDialog() {
  if (!state.cart.size) return
  const total = [...state.cart.values()].reduce((sum,p) => sum + p.precio*p.cantidad-p.descuento,0)
  const previous = state.receipt
  openDialog('Confirmar venta', form('payment-form',
    field('Cliente',input('cliente',previous.cliente,' maxlength="100" placeholder="Cliente general" autofocus'),true)
    + field('Comprobante',`<select name="tipo" id="receipt-kind">${selectOptions(['Boleta','Factura'],previous.tipo)}</select>`)
    + field('Documento',input('documento',previous.documento,'inputmode="numeric" maxlength="11" placeholder="DNI o RUC"'))
    + field('Medio de pago',`<select name="pago">${selectOptions(methods,previous.pago)}</select>`,true)
    + `<div class="field wide"><div class="total-row"><span>Total a cobrar</span><span>${money(total)}</span></div></div>`, 'Confirmar venta'))
  updateDocument()
}
function updateDocument() {
  const form = document.querySelector('#payment-form')
  const isInvoice = form.elements.tipo.value === 'Factura'
  form.elements.cliente.required = isInvoice
  form.elements.documento.required = isInvoice
  form.elements.documento.pattern = isInvoice ? '\\d{11}' : '(?:\\d{8}|\\d{11})'
  form.elements.documento.placeholder = isInvoice ? 'RUC de 11 dígitos' : 'DNI o RUC (opcional)'
}
function showReceipt(sale) {
  openDialog('Comprobante interno',`<div class="form-body"><div class="receipt-info"><h3>${html(sale.tipo)} ${invoice(sale)}</h3>
    <p>Ferretería JyK · ${localDateTime.format(new Date(sale.fecha))}</p>
    <p>${html(sale.cliente)}${sale.documento ? ' · ' + html(sale.documento) : ''}</p>
    <p>Pago: ${html(sale.pago)}</p><span class="badge neutral">Uso interno</span></div>
    ${table(['Producto','Cant.','Precio','Desc.','Importe'],sale.articulos.map(item => `<tr><td>${html(item.nombre)}</td>
      <td>${item.cantidad}</td><td>${money(item.precio)}</td><td>${money(item.descuento)}</td><td>${money(item.cantidad*item.precio-item.descuento)}</td></tr>`))}
    <div class="total-row"><span>Total</span><span>${money(sale.total)}</span></div>
    <div class="modal-actions">${btn('Cerrar','cerrar')}${btn('Imprimir','imprimir','print','primary')}</div></div>`)
}
async function searchDialog() {
  state.catalog ??= await api('catalogo')
  openDialog('Buscar producto',`<div class="form-body"><label class="field">Nombre o SKU<input type="search" id="global-search" placeholder="Ej. taladro" autofocus></label></div><div id="search-results" class="product-picker">${productList('', 'global')}</div>`)
}
function toggleMenu(force) {
  const open = document.body.classList.toggle('menu-open',force)
  document.querySelector('.mobile-menu').setAttribute('aria-expanded', String(open))
}
function showStockNotice() {
  const alerts = state.catalog?.productos.some(p => p.stock <= p.minimo)
  document.querySelector('#alert-dot').hidden = !alerts
}
async function render() {
  if (!state.user) return
  const [requested,sub] = location.hash.slice(1).split('/')
  const page = Object.hasOwn(titles,requested) && canOpen(requested) ? requested : homePage()
  const validSub = page === 'ventas' ? ['historial'] : page === 'inventario' ? ['alertas',...(has('inventario') ? ['movimientos'] : [])] : []
  state.page = page
  state.sub = validSub.includes(sub) ? sub : ''
  const expectedHash = '#' + page + (state.sub ? '/' + state.sub : '')
  if (location.hash !== expectedHash) historyNavigation(expectedHash)
  const load = ++state.viewLoad
  chartResize?.disconnect()
  document.querySelector('#breadcrumb').textContent = titles[page]
  document.querySelectorAll('.navigation a').forEach(a => {
    if (a.hash === '#' + page) a.setAttribute('aria-current','page')
    else a.removeAttribute('aria-current')
  })
  try {
    let result
    if (page === 'panel' || page === 'reportes') {
      result = await api('panel?dias=' + state.dias)
    } else if (page === 'usuarios' || page === 'actividad') {
      result = await api(page)
    } else if (page === 'ventas' && state.sub === 'historial') {
      result = await api('ventas?' + new URLSearchParams({ ...state.salesFilters, pagina: state.salesPage }))
    } else {
      const [catalog, movements] = await Promise.all([api('catalogo'), state.sub === 'movimientos' ? api('movimientos') : null])
      if (load !== state.viewLoad) return
      state.catalog = catalog
      if (canOpen('inventario')) showStockNotice()
      result = movements
    }
    if (load !== state.viewLoad) return
    if (page === 'panel' || page === 'reportes') {
      state.panel = result
      document.querySelector('#alert-dot').hidden = !result.inventario.alertas
      main.innerHTML = page === 'panel' ? dashboard(result) : report(result)
      drawChart(result.serie)
    }
    if (page === 'ventas') main.innerHTML = state.sub === 'historial' ? history(result) : checkout()
    if (page === 'inventario') main.innerHTML = state.sub === 'movimientos' ? movements(result) : inventory()
    if (page === 'proveedores') main.innerHTML = suppliers()
    if (page === 'usuarios') {
      state.accounts = result
      main.innerHTML = userPage(result)
    }
    if (page === 'actividad') main.innerHTML = activityPage(result)
  } catch (error) {
    if (load !== state.viewLoad) return
    main.innerHTML = `${pageHead(titles[page],'')}<div class="card">${empty(error.message)}<div class="alert-foot">${btn('Reintentar','reintentar',null,'quiet')}</div></div>`
  }
}

document.addEventListener('click', async event => {
  const button = event.target.closest('[data-action]')
  if (!button) {
    if (event.target.closest('.navigation a')) toggleMenu(false)
    return
  }
  const { action } = button.dataset
  const id = Number(button.dataset.id)
  try {
    if (action === 'ver-clave') {
      const password = loginForm.elements.clave
      const visible = password.type === 'password'
      password.type = visible ? 'text' : 'password'
      button.setAttribute('aria-pressed',String(visible))
      button.setAttribute('aria-label',visible ? 'Ocultar contraseña' : 'Mostrar contraseña')
      return
    }
    if (!state.user) return
    if (action === 'salir') {
      button.disabled = true
      try {
        await api('logout','POST',{})
        showLogin()
        window.history.replaceState(null,'',location.pathname + location.search)
      } finally {
        button.disabled = false
      }
      return
    }
    if (action === 'menu') toggleMenu(!document.body.classList.contains('menu-open'))
    if (action === 'buscar') await searchDialog()
    if (action === 'alertas') location.hash = 'inventario/alertas'
    if (action === 'reintentar') await render()
    if (action === 'buscar-resultado') {
      modal.close()
      const destination = canOpen('inventario') ? 'inventario' : 'ventas'
      if (state.page !== destination || state.sub) {
        historyNavigation('#' + destination)
        await render()
      }
      const product = state.catalog.productos.find(p => p.id === id)
      const filter = document.querySelector(destination === 'inventario' ? '#inventory-search' : '#sale-search')
      filter.value = product?.sku || ''
      filter.dispatchEvent(new Event('input',{ bubbles:true }))
      filter.focus()
    }
    if (action === 'producto') productDialog(id)
    if (action === 'proveedor') supplierDialog(id)
    if (action === 'usuario') userDialog(id)
    if (action === 'movimiento') movementDialog(id)
    if (['agregar','restar','quitar'].includes(action)) changeCart(action,id,button)
    if (action === 'cobrar') paymentDialog()
    if (action === 'cerrar' && !state.submittingSale) modal.close()
    if (action === 'comprobante') showReceipt(await api('ventas/' + id))
    if (action === 'imprimir') window.print()
    if (action === 'anterior' || action === 'siguiente') {
      state.salesPage += action === 'siguiente' ? 1 : -1
      await render()
    }
  } catch (error) {
    notify(error.message)
  }
})
function historyNavigation(path) {
  window.history.replaceState(null,'',path)
}
document.addEventListener('input', event => {
  const { id, value, dataset } = event.target
  if (id === 'inventory-search') document.querySelector('#inventory-rows').innerHTML = inventoryRows()
  if (id === 'sale-search') document.querySelector('#sale-products').innerHTML = productList(value)
  if (id === 'global-search') document.querySelector('#search-results').innerHTML = productList(value,'global')
  if (dataset.discount) {
    const entry = state.cart.get(Number(dataset.discount))
    const discount = Math.round(Number(value || 0) * 100)
    entry.descuento = Math.max(0,Math.min(entry.precio * entry.cantidad,discount))
    state.saleToken = null
    document.querySelector('#cart .total-row span:last-child').textContent = money(
      [...state.cart.values()].reduce((sum,p) => sum + p.precio*p.cantidad-p.descuento,0))
  }
})
document.addEventListener('change', event => {
  const { id, value, dataset } = event.target
  if (id === 'periodo') {
    state.dias = Number(value)
    render()
  }
  if (id === 'inventory-category') document.querySelector('#inventory-rows').innerHTML = inventoryRows()
  if (id === 'movement-kind') movementFields()
  if (id === 'receipt-kind') updateDocument()
  if (dataset.discount) {
    const entry = state.cart.get(Number(dataset.discount))
    if (entry) event.target.value = currencyInput(entry.descuento)
  }
})
document.addEventListener('keydown', event => {
  if (state.user && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault()
    if (!modal.open) searchDialog().catch(error => notify(error.message))
  }
  if (event.key === 'Escape' && document.body.classList.contains('menu-open')) toggleMenu(false)
})
modal.addEventListener('cancel', event => {
  if (state.submittingSale) event.preventDefault()
})
document.addEventListener('submit', async event => {
  event.preventDefault()
  const form = event.target
  const formData = new FormData(form)
  const data = Object.fromEntries(formData)
  if (form.id === 'login-form') {
    const submit = form.querySelector('[type="submit"]')
    if (submit.disabled) return
    submit.disabled = true
    loginError.hidden = true
    loginStatus.textContent = 'Ingresando…'
    loginStatus.hidden = false
    try {
      const user = await api('login','POST',data)
      await enter(user)
    } catch (error) {
      loginError.textContent = error.message
      loginError.hidden = false
    } finally {
      loginStatus.hidden = true
      submit.disabled = false
    }
    return
  }
  if (!state.user) return
  if (form.id === 'sales-filters') {
    state.salesFilters = data
    state.salesPage = 1
    await render()
    return
  }
  if (form.dataset.busy) return
  form.dataset.busy = '1'
  const submit = form.querySelector('[type="submit"]')
  submit.disabled = true
  const errorText = form.querySelector('.form-error')
  errorText.hidden = true
  const cents = key => Math.round(Number(data[key])*100)
  try {
    if (form.id === 'payment-form') {
      state.submittingSale = true
      state.receipt = data
      state.saleToken ??= crypto.randomUUID()
      const articulos = [...state.cart.values()].map(({ id,cantidad,precio,descuento }) => ({ id,cantidad,precio,descuento }))
      const sale = await api('ventas','POST',{ ...data, solicitud: state.saleToken, articulos })
      state.cart.clear()
      state.receipt = {}
      state.saleToken = null
      showReceipt(sale)
      notify('Venta registrada.')
    } else {
      if (form.id === 'product-form') {
        await api('productos' + (data.id ? '/' + data.id : ''),data.id ? 'PUT' : 'POST',{
          ...data, precio: cents('precio'), costo: cents('costo'), stock: Number(data.stock),
          minimo: Number(data.minimo), proveedores: formData.getAll('proveedores').map(Number),
        })
      }
      if (form.id === 'supplier-form') {
        await api('proveedores' + (data.id ? '/' + data.id : ''),data.id ? 'PUT' : 'POST',{
          ...data, productos: formData.getAll('productos').map(Number),
        })
      }
      if (form.id === 'movement-form') {
        await api('movimientos','POST',{ ...data, id: Number(data.id), cantidad: Number(data.cantidad), costo: cents('costo'), proveedor: Number(data.proveedor) })
      }
      if (form.id === 'user-form') {
        const self = Number(data.id) === state.user.id
        await api('usuarios' + (data.id ? '/' + data.id : ''),data.id ? 'PUT' : 'POST',{
          ...data, rol: self ? state.user.rol : data.rol, activo: self || data.activo === '1',
        })
        if (self) {
          const current = await api('sesion')
          await enter(current,true)
        }
      }
      modal.close()
      notify('Cambios guardados.')
    }
    await render()
    if (has('reportes')) api('panel?dias=' + state.dias).then(panel => {
      document.querySelector('#alert-dot').hidden = !panel.inventario.alertas
    }).catch(() => {})
  } catch (error) {
    errorText.textContent = error.message
    errorText.hidden = false
    if (error.status === 409 && form.id === 'payment-form') {
      state.saleToken = null
      try {
        state.catalog = await api('catalogo')
        for (const [id,entry] of state.cart) {
          const latest = state.catalog.productos.find(p => p.id === id)
          if (!latest?.stock) {
            state.cart.delete(id)
          } else {
            entry.stock = latest.stock
            entry.precio = latest.precio
            entry.cantidad = Math.min(entry.cantidad, latest.stock)
            entry.descuento = Math.min(entry.descuento, entry.cantidad*entry.precio)
          }
        }
        submit.textContent = 'Revisar carrito'
        submit.type = 'button'
        submit.dataset.action = 'cerrar'
        refreshCart()
      } catch {
        // Keep the pending sale visible until catalog data can be refreshed.
      }
    }
  } finally {
    submit.disabled = false
    delete form.dataset.busy
    state.submittingSale = false
  }
})
window.addEventListener('hashchange', () => {
  toggleMenu(false)
  render()
  window.scrollTo(0,0)
})
initialize()
