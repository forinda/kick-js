/**
 * The slice of the request/response this logger touches, from node's shapes
 * rather than Express's. This runs under EVERY runtime — Fastify and h3 hand
 * connect middleware the raw node objects — so anything Express-only is
 * `undefined` there.
 */
interface LoggedRequest {
  method?: string
  url?: string
  /** Express-only convenience; the raw node request has only `url`. */
  path?: string
  /** Express-only; absent on the raw node request the other runtimes pass. */
  originalUrl?: string
  headers: Record<string, string | string[] | undefined>
}

interface LoggedResponse {
  statusCode: number
  on(event: 'finish', listener: () => void): unknown
}

/** Pathname only — `req.url` carries the query string. */
function pathnameOf(url: string | undefined): string {
  if (!url) return '/'
  const q = url.indexOf('?')
  return (q === -1 ? url : url.slice(0, q)) || '/'
}
import { createLogger } from '../../core'

export interface RequestLoggerOptions {
  /** Logger name (default: 'HTTP') */
  name?: string
  /** Log level for successful requests (default: 'info') */
  level?: 'info' | 'debug' | 'trace'
  /** Skip logging for paths matching these prefixes (e.g. ['/health', '/_debug']) */
  skip?: string[]
}

/**
 * Middleware that logs every request with method, URL, status, duration, and request ID.
 *
 * @example
 * ```ts
 * bootstrap({
 *   middleware: [requestId(), requestLogger(), express.json()],
 * })
 * ```
 *
 * Output:
 * ```
 * [HTTP] GET /api/v1/users 200 12ms req-abc123
 * [HTTP] POST /api/v1/users 201 45ms req-def456
 * ```
 */
export function requestLogger(options: RequestLoggerOptions = {}) {
  const log = createLogger(options.name ?? 'HTTP')
  const level = options.level ?? 'info'
  const skip = options.skip ?? []

  return (req: LoggedRequest, res: LoggedResponse, next: () => void) => {
    // `req.path` is Express-only. Under Fastify and h3 it is `undefined`, so
    // this threw `Cannot read properties of undefined (reading 'startsWith')`
    // on EVERY request as soon as a `skip` prefix was configured — the
    // middleware crashed the request rather than declining to log it.
    const pathname = req.path ?? pathnameOf(req.url)
    if (skip.some((prefix) => pathname.startsWith(prefix))) {
      return next()
    }

    const start = Date.now()

    res.on('finish', () => {
      const duration = Date.now() - start
      const requestId = (req as any).requestId || req.headers['x-request-id'] || '-'
      const status = res.statusCode

      // `originalUrl` is Express-only — on Fastify and h3 this logged
      // `GET undefined 200 12ms`, dropping the path from every access-log
      // line under those runtimes.
      const path = req.originalUrl ?? req.url
      log[level](`${req.method} ${path} ${status} ${duration}ms ${requestId}`)
    })

    next()
  }
}
