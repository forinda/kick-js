/**
 * Response helpers that work on every runtime.
 *
 * Connect middleware receives an Express response under Express and a raw
 * `ServerResponse` under Fastify and h3. `res.cookie()` and `res.status().json()`
 * are Express conveniences that do not exist on the raw object, so a shipped
 * middleware reaching for them works on one engine and throws on the other two:
 *
 *   csrf       → `res.cookie()` threw before any check ran, so EVERY request
 *                became a 500 — including safe methods the middleware is
 *                supposed to wave through
 *   rateLimit  → `res.status()` threw only once the limit was hit, and the
 *                throw left the request hanging rather than answering 429
 *   session    → `res.cookie()` threw on every response that issued a session
 *
 * These take the Express path when it is there — so behaviour under Express is
 * byte-identical to before — and fall back to the Node primitives otherwise.
 *
 * @module @forinda/kickjs/http/middleware/respond
 */

/** Cookie attributes, matching the subset of Express's `res.cookie` we use. */
export interface CookieOptions {
  maxAge?: number
  expires?: Date
  domain?: string
  path?: string
  httpOnly?: boolean
  secure?: boolean
  sameSite?: boolean | 'lax' | 'strict' | 'none'
}

interface AnyResponse {
  cookie?: (name: string, value: string, options?: CookieOptions) => unknown
  status?: (code: number) => { json?: (body: unknown) => unknown }
  statusCode?: number
  getHeader?: (name: string) => unknown
  setHeader?: (name: string, value: unknown) => unknown
  end?: (chunk?: unknown) => unknown
}

/** `Set-Cookie` value for one cookie, per RFC 6265 §4.1. */
function serializeCookie(name: string, value: string, options: CookieOptions): string {
  const parts = [`${name}=${encodeURIComponent(value)}`]
  // Express takes `maxAge` in milliseconds; `Max-Age` is seconds.
  if (options.maxAge !== undefined) parts.push(`Max-Age=${Math.floor(options.maxAge / 1000)}`)
  if (options.expires) parts.push(`Expires=${options.expires.toUTCString()}`)
  if (options.domain) parts.push(`Domain=${options.domain}`)
  parts.push(`Path=${options.path ?? '/'}`)
  if (options.httpOnly) parts.push('HttpOnly')
  if (options.secure) parts.push('Secure')
  if (options.sameSite) {
    // `true` means Strict, matching Express.
    const value = options.sameSite === true ? 'Strict' : options.sameSite
    parts.push(`SameSite=${value.charAt(0).toUpperCase()}${value.slice(1)}`)
  }
  return parts.join('; ')
}

/** Set a cookie without assuming Express. Appends, never replaces. */
export function setCookie(
  res: unknown,
  name: string,
  value: string,
  options: CookieOptions = {},
): void {
  const target = res as AnyResponse
  if (typeof target.cookie === 'function') {
    target.cookie(name, value, options)
    return
  }
  const cookie = serializeCookie(name, value, options)
  const prior = target.getHeader?.('Set-Cookie')
  const all = prior === undefined ? [cookie] : [...(Array.isArray(prior) ? prior : [prior]), cookie]
  target.setHeader?.('Set-Cookie', all)
}

/** Send a JSON body with a status, without assuming Express. */
export function sendJson(res: unknown, status: number, body: unknown): void {
  const target = res as AnyResponse
  if (typeof target.status === 'function') {
    const chained = target.status(status)
    if (typeof chained?.json === 'function') {
      chained.json(body)
      return
    }
  }
  target.statusCode = status
  if (!target.getHeader?.('content-type')) {
    target.setHeader?.('content-type', 'application/json; charset=utf-8')
  }
  target.end?.(JSON.stringify(body))
}
