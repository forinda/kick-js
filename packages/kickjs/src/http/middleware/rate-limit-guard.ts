// Ctx-style rate limiter — runs on BOTH pipelines: the node runtimes (via
// `@Middleware()` / class middleware) and the `@forinda/kickjs/web` fetch
// entry (via `@Middleware()` or `createWebApp({ middleware })`), unlike the
// connect-style `rateLimit()` which is node-only. Zero runtime imports —
// part of the edge purity graph.
import type { MiddlewareHandler } from '../../core/decorators'
import type { RequestContext } from '../context'
import type { RateLimitStore } from './rate-limit'

export interface RateLimitGuardOptions {
  /** Maximum number of requests per window (default: 100). */
  max?: number
  /** Time window in milliseconds (default: 60_000). */
  windowMs?: number
  /** Response message when the limit is exceeded (default: 'Too Many Requests'). */
  message?: string
  /** HTTP status code when the limit is exceeded (default: 429). */
  statusCode?: number
  /**
   * Rate-limit key per request. Default: `cf-connecting-ip`, then the first
   * hop of `x-forwarded-for`, then `x-real-ip`, then `'global'`. Return a
   * user/tenant id here for authenticated quotas.
   */
  keyGenerator?: (ctx: RequestContext) => string
  /** Send `X-RateLimit-*` / `Retry-After` headers (default: true). */
  headers?: boolean
  /**
   * Counter backend. Defaults to a per-isolate in-memory map — fine for a
   * single node process, useless on edge where isolates recycle: pass a
   * `KvRateLimitStore` (or Redis-backed store) there.
   */
  store?: RateLimitStore
  /** Skip limiting for a request (health checks, allowlists). */
  skip?: (ctx: RequestContext) => boolean
}

/** Timer-free in-memory store: sweeps expired entries when the map grows. */
class LazyMemoryStore implements RateLimitStore {
  private readonly hits = new Map<string, { hits: number; reset: number }>()

  constructor(private readonly windowMs: number) {}

  async increment(key: string): Promise<{ totalHits: number; resetTime: Date }> {
    const now = Date.now()
    const entry = this.hits.get(key)
    if (entry && entry.reset > now) {
      entry.hits++
      return { totalHits: entry.hits, resetTime: new Date(entry.reset) }
    }
    // ponytail: sweep-on-growth instead of a cleanup interval — no timer to
    // dispose, edge-safe. Bound is 10k live keys before a full sweep.
    if (this.hits.size > 10_000) {
      for (const [k, e] of this.hits) if (e.reset <= now) this.hits.delete(k)
    }
    const fresh = { hits: 1, reset: now + this.windowMs }
    this.hits.set(key, fresh)
    return { totalHits: 1, resetTime: new Date(fresh.reset) }
  }

  async decrement(key: string): Promise<void> {
    const entry = this.hits.get(key)
    if (entry && entry.hits > 0) entry.hits--
  }

  async reset(key: string): Promise<void> {
    this.hits.delete(key)
  }
}

function defaultKey(ctx: RequestContext): string {
  const h = ctx.headers
  const first = (v: unknown): string | undefined =>
    typeof v === 'string' && v.length > 0 ? v.split(',')[0].trim() : undefined
  return (
    first(h['cf-connecting-ip']) ?? first(h['x-forwarded-for']) ?? first(h['x-real-ip']) ?? 'global'
  )
}

/**
 * Rate limiting as a `(ctx, next)` middleware.
 *
 * ```ts
 * // Edge (Cloudflare Workers) — app-wide:
 * const app = createWebApp({
 *   h3, modules,
 *   middleware: [rateLimitGuard({ max: 60, windowMs: 60_000, store: new KvRateLimitStore(env.KV, { windowMs: 60_000 }) })],
 * })
 *
 * // Any runtime — per controller/route:
 * @Middleware(rateLimitGuard({ max: 10 }))
 * @Post('/login')
 * ```
 */
export function rateLimitGuard(options: RateLimitGuardOptions = {}): MiddlewareHandler {
  const max = options.max ?? 100
  const windowMs = options.windowMs ?? 60_000
  const message = options.message ?? 'Too Many Requests'
  const statusCode = options.statusCode ?? 429
  const keyGenerator = options.keyGenerator ?? defaultKey
  const sendHeaders = options.headers ?? true
  const store = options.store ?? new LazyMemoryStore(windowMs)

  return async (ctx: RequestContext, next: () => void): Promise<void> => {
    if (options.skip?.(ctx)) return next()

    const { totalHits, resetTime } = await store.increment(keyGenerator(ctx))
    const remaining = Math.max(0, max - totalHits)

    if (sendHeaders) {
      ctx.setHeader('X-RateLimit-Limit', String(max))
      ctx.setHeader('X-RateLimit-Remaining', String(remaining))
      ctx.setHeader('X-RateLimit-Reset', String(Math.ceil(resetTime.getTime() / 1000)))
    }

    if (totalHits > max) {
      const retryAfter = Math.max(1, Math.ceil((resetTime.getTime() - Date.now()) / 1000))
      if (sendHeaders) ctx.setHeader('Retry-After', String(retryAfter))
      ctx.json({ message }, statusCode)
      return
    }

    next()
  }
}
