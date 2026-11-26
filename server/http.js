export const headers = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; frame-ancestors 'self'; base-uri 'none'; form-action 'self'",
}
export const json = (data, status = 200, extra = {}) => Response.json(data, {
  status, headers: { ...headers, 'Cache-Control': 'no-store', ...extra },
})
export const q = (db, sql, ...args) => db.prepare(sql).bind(...args)
export const all = async (db, sql, ...args) => (await q(db, sql, ...args).all()).results
export const now = () => new Date().toISOString()

export class RequestError extends Error {
  constructor(message, status = 400) {
    super(message)
    this.status = status
  }
}
export function string(value, label, max = 100, required = true) {
  if (typeof value !== 'string' || (required && !value.trim()) || value.trim().length > max) {
    throw new RequestError(label + ' no es válido.')
  }
  return value.trim()
}
export function number(value, label, min = 0, max = 10000000) {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new RequestError(label + ' no es válido.')
  return value
}
export function option(value, choices, label) {
  if (!choices.includes(value)) throw new RequestError(label + ' no es válido.')
  return value
}
export function ids(value) {
  if (!Array.isArray(value) || value.length > 50) throw new RequestError('La selección no es válida.')
  return [...new Set(value.map(id => number(id, 'El código', 1, Number.MAX_SAFE_INTEGER)))]
}
export async function body(request) {
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
