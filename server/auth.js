import { all, json, now, option, q, RequestError, string } from './http.js'

const grants = {
  vendedor: ['stock','ventas'],
  almacenero: ['stock','inventario'],
  dueno: ['stock','catalogo','proveedores','reportes','asistente'],
  administrador: ['stock','ventas','inventario','catalogo','proveedores','reportes','asistente','usuarios','actividad'],
}
const demoUsers = [
  ["vendedor","Vendedor de prueba","vendedor","132c00318c2925ef979bae354be02766","c16b0df2295b265a4d97591c22951b943ab414e3eb355938f78ff4a575d9df47"],
  ["almacenero","Almacenero de prueba","almacenero","caa637ecc862b34c24e6fba8080894ad","69dee6022c9cf50ba9c4da647113400308553ed123ea02f093d659ea546c21ae"],
  ["dueno","Dueño de prueba","dueno","7fcf59a1f7bcccd1f5617843982b2e25","8ca3291cd6dfe70d8fdd4c8a7f6df67cc1a593956a5206e3c3c9b8824eb605b4"],
  ["admin","Administrador de prueba","administrador","f93e67487306a55595d04a5b701cc450","c0c1e1542a6efb0c13ad49c84ee222afe0350b49e73f9d2c5c5d1221a5f6d1e5"],
]
const additionalDemoUsers = [
  ["ventas2","Segundo vendedor de prueba","vendedor","3253c92d158533c844882c50de44eaae","018c0e1e0a64254b3cbf47b1c671a6721e8b988cf5082a04b437773b2a828a5e"],
  ["almacen2","Segundo almacenero de prueba","almacenero","6b50aedff14cfba7ec9e0855dc6d00c8","d649487c4406696a29898e805f3932d05ad0c2646c37741bae74abf4633d5f10"],
]
const lifetime = 8 * 60 * 60
const attemptWindow = 10 * 60 * 1000
const encoder = new TextEncoder()
const hex = bytes => Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2,'0')).join('')
const randomHex = length => hex(crypto.getRandomValues(new Uint8Array(length)))
const sha256 = async value => hex(await crypto.subtle.digest('SHA-256',encoder.encode(value)))

export async function hashPassword(password, salt = randomHex(16)) {
  const bytes = Uint8Array.from(salt.match(/../g), value => parseInt(value,16))
  const key = await crypto.subtle.importKey('raw',encoder.encode(password),'PBKDF2',false,['deriveBits'])
  const derived = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: bytes, iterations: 100000 },key,256)
  return { salt, hash: hex(derived) }
}
function equalHash(left, right) {
  let difference = 0
  for (let i = 0; i < left.length; i++) difference |= left.charCodeAt(i) ^ right.charCodeAt(i)
  return difference === 0
}
export async function provisionarUsuarios(db) {
  const versions = [['usuarios-demo',demoUsers],['usuarios-demo-equipo',additionalDemoUsers]]
  const current = () => all(db,"SELECT clave FROM configuracion WHERE clave IN ('usuarios-demo','usuarios-demo-equipo')")
  const existing = new Set((await current()).map(row => row.clave))
  const missing = versions.filter(([clave]) => !existing.has(clave))
  if (!missing.length) return
  const statements = []
  for (const [clave,accounts] of missing) {
    statements.push(q(db,'INSERT INTO configuracion VALUES (?)',clave))
    for (const [usuario,nombre,rol,sal,hash] of accounts) {
      statements.push(q(db,`INSERT INTO usuarios(usuario,nombre,rol,sal,clave_hash,creado) VALUES (?,?,?,?,?,?)
        ON CONFLICT(usuario) DO NOTHING`,usuario,nombre,rol,sal,hash,now()))
    }
    if (clave === 'usuarios-demo') {
      statements.push(db.prepare("UPDATE ventas SET usuario_id=(SELECT id FROM usuarios WHERE usuario='vendedor') WHERE usuario_id IS NULL AND solicitud GLOB 'demo-*'"))
    }
  }
  try {
    await db.batch(statements)
  } catch (error) {
    const after = new Set((await current()).map(row => row.clave))
    if (missing.some(([clave]) => !after.has(clave))) throw error
  }
}
function username(value) {
  const name = string(value,'El usuario',32).toLowerCase()
  if (!/^[a-z0-9._-]{3,32}$/.test(name)) throw new RequestError('El usuario debe tener de 3 a 32 letras, números, puntos, guiones o guiones bajos.')
  return name
}
function cookie(request, token, seconds) {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : ''
  return `jyk_sesion=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${seconds}${secure}`
}
function rawToken(request) {
  return request.headers.get('cookie')?.match(/(?:^|;\s*)jyk_sesion=([0-9a-f]{64})(?:;|$)/)?.[1]
}
function identity(request) {
  return request.headers.get('oai-authenticated-user-id') || 'localhost'
}
export function viewUser(user) {
  return { id:user.id, usuario:user.usuario, nombre:user.nombre, rol:user.rol, permisos:grants[user.rol] }
}
export function can(user, permission) {
  return grants[user.rol].includes(permission)
}
export function permit(user, permission) {
  if (!can(user,permission)) throw new RequestError('Tu rol no tiene acceso a esta operación.',403)
}
export function audit(db, user, action, detail = '') {
  return q(db,'INSERT INTO actividad(usuario_id,fecha,accion,detalle) VALUES (?,?,?,?)',user.id,now(),action,detail)
}
export async function login(db, request, data) {
  const name = username(data.usuario)
  if (typeof data.clave !== 'string' || data.clave.length < 1 || data.clave.length > 128) {
    throw new RequestError('Usuario o contraseña incorrectos.',401)
  }
  await provisionarUsuarios(db)
  const who = identity(request)
  const attemptKey = await sha256(who + '\n' + (request.headers.get('CF-Connecting-IP') || '') + '\n' + name)
  const time = Date.now()
  const windowStart = Math.floor(time / attemptWindow) * attemptWindow
  const attempt = await q(db,`INSERT INTO intentos_login(clave,ventana,cantidad) VALUES (?,?,1)
    ON CONFLICT(clave,ventana) DO UPDATE SET cantidad=cantidad+1 WHERE cantidad < 8
    RETURNING cantidad`,attemptKey,windowStart).first()
  if (!attempt) throw new RequestError('Demasiados intentos. Vuelve a intentarlo en unos minutos.',429)
  const user = await q(db,'SELECT * FROM usuarios WHERE usuario=?',name).first()
  const { hash } = await hashPassword(data.clave,user?.sal || demoUsers[0][3])
  const valid = equalHash(hash,user?.clave_hash || demoUsers[0][4])
  if (!valid || !user?.activo) throw new RequestError('Usuario o contraseña incorrectos.',401)

  const token = randomHex(32)
  const currentToken = rawToken(request)
  const queries = [
    q(db,'DELETE FROM sesiones WHERE vence <= ?',time),
    q(db,'DELETE FROM intentos_login WHERE ventana < ? OR (clave=? AND ventana=?)',windowStart,attemptKey,windowStart),
    q(db,'INSERT INTO sesiones VALUES (?,?,?,?,?)',await sha256(token),user.id,who,user.revision,time+lifetime*1000),
    audit(db,user,'Inicio de sesión'),
  ]
  if (currentToken) queries.unshift(q(db,'DELETE FROM sesiones WHERE token_hash=? AND identidad=?',await sha256(currentToken),who))
  await db.batch(queries)
  return json(viewUser(user),200,{'Set-Cookie':cookie(request,token,lifetime)})
}
export async function session(db, request) {
  const token = rawToken(request)
  if (!token) throw new RequestError('Inicia sesión para continuar.',401)
  const user = await q(db,`SELECT u.id,u.usuario,u.nombre,u.rol FROM sesiones s JOIN usuarios u ON u.id=s.usuario_id
    WHERE s.token_hash=? AND s.identidad=? AND s.vence>? AND s.revision=u.revision AND u.activo=1`,
    await sha256(token),identity(request),Date.now()).first()
  if (!user) throw new RequestError('Inicia sesión para continuar.',401)
  return user
}
export async function logout(db, request, user) {
  await db.batch([
    q(db,'DELETE FROM sesiones WHERE token_hash=? AND identidad=?',await sha256(rawToken(request)),identity(request)),
    audit(db,user,'Cierre de sesión'),
  ])
  return json({ok:true},200,{'Set-Cookie':cookie(request,'',0)})
}
export async function users(db) {
  return all(db,'SELECT id,usuario,nombre,rol,activo,creado FROM usuarios ORDER BY activo DESC,nombre,usuario')
}
export async function activity(db) {
  return all(db,'SELECT a.id,a.fecha,a.accion,a.detalle,u.usuario,u.nombre FROM actividad a JOIN usuarios u ON u.id=a.usuario_id ORDER BY a.id DESC LIMIT 100')
}
export async function saveUser(db, actor, data, id) {
  const user = username(data.usuario)
  const name = string(data.nombre,'El nombre')
  const role = option(data.rol,Object.keys(grants),'El rol')
  const active = option(data.activo,[true,false],'El estado') ? 1 : 0
  const password = data.clave ?? ''
  const changesPassword = Boolean(password) || !id
  if (typeof password !== 'string' || (changesPassword && (password.length < 12 || password.length > 128 || !password.trim()))) {
    throw new RequestError('La contraseña debe tener entre 12 y 128 caracteres.')
  }
  if (id === actor.id && (role !== actor.rol || !active)) throw new RequestError('Tu cuenta debe conservar el rol y permanecer activa.',409)
  const { salt, hash } = changesPassword ? await hashPassword(password) : {}
  const queries = []
  if (id) {
    if (!(await q(db,'SELECT id FROM usuarios WHERE id=?',id).first())) throw new RequestError('Usuario no encontrado.',404)
    queries.push(q(db,`UPDATE usuarios SET usuario=?,nombre=?,rol=?,activo=?,sal=COALESCE(?,sal),clave_hash=COALESCE(?,clave_hash),
      revision=revision+CASE WHEN usuario<>? OR rol<>? OR activo<>? OR ? IS NOT NULL THEN 1 ELSE 0 END WHERE id=?`,
      user,name,role,active,salt ?? null,hash ?? null,user,role,active,hash ?? null,id))
  } else {
    queries.push(q(db,'INSERT INTO usuarios(usuario,nombre,rol,activo,sal,clave_hash,creado) VALUES (?,?,?,?,?,?,?)',
      user,name,role,active,salt,hash,now()))
  }
  queries.push(audit(db,actor,id ? 'Usuario actualizado' : 'Usuario creado',user + ' · ' + role + ' · ' + (active ? 'Activo' : 'Inactivo')))
  await db.batch(queries)
  return {ok:true}
}
