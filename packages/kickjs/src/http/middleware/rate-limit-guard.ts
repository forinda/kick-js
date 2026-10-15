// Ctx-style rate limiter — runs on BOTH pipelines: the node runtimes (via
// `@Middleware()` / class middleware) and the `@forinda/kickjs/web` fetch
// entry (via `@Middleware()` or `createWebApp({ middleware })`), unlike the
// connect-style `rateLimit()` which is node-only. Zero runtime imports —
// part of the edge purity graph.
import { assertFlagTest, matchesFlagTest, type RouteFlagTest } from '../../core/route-flag'
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
   * Rate-limit key per request. Defaults to `ctx.ip`, falling back to
   * `'global'`. Return a user/tenant id here for authenticated quotas.
   *
   * ::: warning Behind a proxy, configure `trustProxy` or every client shares
   * one bucket
   * On a node runtime `ctx.ip` is the runtime's vetted client address —
   * Express derives it from `trust proxy`, Fastify from `trustProxy`. Without
   * that setting it is the SOCKET address, which behind a load balancer or
   * Cloudflare is the proxy's, so every caller lands in the same bucket and one
   * noisy client exhausts the allowance for everyone.
   *
   * `bootstrap({ trustProxy: true })` is the fix. Forwarded headers are
   * deliberately not consulted here: `x-forwarded-for` is client-controllable
   * unless a proxy overwrites it, so trusting it unconditionally would let a
   * direct caller mint a fresh allowance per request by varying the header —
   * evading the limit rather than enforcing it. The header chain
   * (`cf-connecting-ip` → `x-forwarded-for` → `x-real-ip`) applies only on the
   * `@forinda/kickjs/web` edge entry, where there is no socket and the platform
   * has already terminated the connection.
   * :::
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
  /**
   * Skip limiting on routes carrying a route flag — a name, a list of names
   * (any-of), or a predicate. Declared on the route rather than restated as a
   * path here, so it cannot drift when `apiPrefix` or a module's `version`
   * changes:
   *
   * ```ts
   * const Public = defineRouteFlag('auth.public')
   * rateLimitGuard({ max: 60, exemptWhen: 'auth.public' })
   * ```
   *
   * Only meaningful where a route has been matched — as `@Middleware()` on a
   * class or method, or in `createWebApp({ middleware })`. Mounted app-wide
   * ahead of routing there is no route to read, and nothing is exempted.
   */
  exemptWhen?: RouteFlagTest
}

// ponytail: fixed cap; a store shared between instances has its own limits.
const MAX_KEYS = 100_000

/**
 * Timer-free in-memory store. Kept in window order (a refreshed key moves to
 * the back), so expired entries are always at the front: each insert drops
 * them from there and stops at the first live one — no full scan. Keys come
 * from clients (on an edge host, the first `x-forwarded-for` hop), so the map
 * holds at most {@link MAX_KEYS}: past that, new keys are refused until a
 * window ends. Live counters are never dropped — that would let a flood of
 * keys reset someone else's count.
 */
/** @internal Exported for tests. */
export class LazyMemoryStore implements RateLimitStore {
  private readonly hits = new Map<string, { hits: number; reset: number }>()

  constructor(private readonly windowMs: number) {}

  async increment(key: string): Promise<{ totalHits: number; resetTime: Date }> {
    const now = Date.now()
    const entry = this.hits.get(key)
    if (entry && entry.reset > now) {
      entry.hits++
      return { totalHits: entry.hits, resetTime: new Date(entry.reset) }
    }
    this.hits.delete(key)
    for (const [k, e] of this.hits) {
      if (e.reset > now) break
      this.hits.delete(k)
    }
    // Still full: refuse the new key (over any limit until the oldest window
    // ends) rather than drop a live counter someone could then reset.
    if (this.hits.size >= MAX_KEYS) {
      const oldest = this.hits.values().next().value!
      return { totalHits: Number.POSITIVE_INFINITY, resetTime: new Date(oldest.reset) }
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
  // `ctx.ip` carries the resolution that used to live here: prefer the
  // runtime-computed address (Express derives it from `trust proxy`), fall
  // back to forwarded headers only for runtimes that compute none.
  return ctx.ip ?? 'global'
}

/**
 * Rate limiting as a `(ctx, next)` middleware.
 *
 * ```ts
 * // Edge (Cloudflare Workers) — app-wide:
 * const app = createWebApp({
 *   h3, modules,
 *   middlewares: [rateLimitGuard({ max: 60, windowMs: 60_000, store: new KvRateLimitStore(env.KV, { windowMs: 60_000 }) })],
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

  const exemptWhen = options.exemptWhen
  if (exemptWhen !== undefined) assertFlagTest(exemptWhen, 'rateLimitGuard({ exemptWhen })')

  return async (ctx: RequestContext, next: () => void): Promise<void> => {
    if (options.skip?.(ctx)) return next()
    if (exemptWhen !== undefined && matchesFlagTest(exemptWhen, ctx.route?.flags, ctx.route)) {
      return next()
    }

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
