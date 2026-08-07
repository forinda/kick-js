/**
 * Client address + pathname resolution shared by everything that runs as
 * connect-style middleware.
 *
 * Fastify and h3 hand middleware the RAW node request, so the Express
 * conveniences (`req.ip`, `req.path`, `req.originalUrl`) are `undefined`
 * there. Reading them directly produced two live bugs:
 *
 *   rate-limit → every caller keyed as the `'127.0.0.1'` fallback, i.e. ONE
 *                shared bucket, so a single client could exhaust the limit
 *                for everyone
 *   csrf       → `ignorePaths` never matched, so configured exemptions were
 *                silently dead
 *
 * Edge-safe: no node imports.
 */

/** The request members these helpers read, from node's shape rather than Express's. */
export interface ClientRequestLike {
  url?: string
  /** Express-only convenience. */
  path?: string
  /** Express-only; the full path before router mounting rewrote `url`. */
  originalUrl?: string
  /** Express and Fastify compute this from their trust-proxy settings. */
  ip?: unknown
  headers?: Record<string, string | string[] | undefined>
  socket?: { remoteAddress?: string }
}

/** First entry of a possibly comma-separated header value. */
function firstHop(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value.split(',')[0]!.trim() : undefined
}

/**
 * The client's IP address, or `undefined` when it cannot be determined.
 *
 * Prefers the address the runtime computed — Express derives `req.ip` from
 * `trust proxy`, Fastify from `trustProxy` — because raw forwarded headers are
 * client-SPOOFABLE wherever nothing normalizes them. h3 takes the same stance:
 * its `getRequestIP` only consults `x-forwarded-for` when explicitly opted in.
 *
 * Header fallbacks apply only to runtimes that compute no address at all
 * (notably the web/edge entry, which has no socket either).
 */
export function resolveClientIp(req: ClientRequestLike): string | undefined {
  if (typeof req.ip === 'string' && req.ip.length > 0) return req.ip
  const h = req.headers ?? {}
  return (
    firstHop(h['cf-connecting-ip']) ??
    firstHop(h['x-forwarded-for']) ??
    firstHop(h['x-real-ip']) ??
    (req.socket?.remoteAddress || undefined)
  )
}

/** Pathname only — `req.url` carries the query string, and `req.path` is Express-only. */
export function resolvePathname(req: ClientRequestLike): string {
  if (typeof req.path === 'string' && req.path.length > 0) return req.path
  const url = req.url
  if (!url) return '/'
  const q = url.indexOf('?')
  return (q === -1 ? url : url.slice(0, q)) || '/'
}
