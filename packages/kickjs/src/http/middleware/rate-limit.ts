import { matchesFlagTest, type RouteFlagTest } from '../../core/route-flag'
import { bindRoutePolicy, type RoutePolicyTable } from '../../core/route-policy'
import { sendJson } from './respond'
import type { Request, Response, NextFunction } from 'express'
import { resolveClientIp, resolvePathname, type ClientRequestLike } from '../client-ip'

import { registerDisposable } from '../../core/disposables'

export interface RateLimitStore {
  increment(key: string): Promise<{ totalHits: number; resetTime: Date }>
  decrement(key: string): Promise<void>
  reset(key: string): Promise<void>
}

export interface RateLimitOptions {
  /** Maximum number of requests per window (default: 100) */
  max?: number
  /** Time window in milliseconds (default: 60_000) */
  windowMs?: number
  /** Response message when rate limit is exceeded (default: 'Too Many Requests') */
  message?: string
  /** HTTP status code when rate limit is exceeded (default: 429) */
  statusCode?: number
  /** Function to generate the key for rate limiting (default: req.ip) */
  keyGenerator?: (req: Request) => string
  /** Whether to send rate limit headers (default: true) */
  headers?: boolean
  /** Custom store implementation (default: in-memory Map) */
  store?: RateLimitStore
  /** Function to skip rate limiting for certain requests */
  skip?: (req: Request) => boolean
  /** Paths to exclude from rate limiting */
  skipPaths?: string[]
  /**
   * Skip limiting on routes carrying a route flag — a name, a list of names
   * (any-of), or a predicate.
   *
   * This middleware runs before route matching, so it has no `ctx.route` to
   * read. Instead the Application hands it a table of every mounted route's
   * flags at boot, and the incoming method + pathname is looked up against it.
   * Requests matching no route match no flags — which is the point of limiting
   * here rather than in a route-scoped guard.
   *
   * ```ts
   * const Public = defineRouteFlag('auth.public')
   * bootstrap({ middlewares: [rateLimit({ max: 60, exemptWhen: 'auth.public' })] })
   * ```
   *
   * Prefer `skipPaths` only for paths that are not routes at all (a static
   * mount, a proxied prefix); a flag cannot describe those.
   */
  exemptWhen?: RouteFlagTest
}

interface MemoryStoreEntry {
  totalHits: number
  resetTime: Date
}

class MemoryStore implements RateLimitStore {
  private hits = new Map<string, MemoryStoreEntry>()
  private cleanupTimer: ReturnType<typeof setInterval>

  constructor(private windowMs: number) {
    this.cleanupTimer = setInterval(() => this.cleanup(), windowMs)
    // Allow the process to exit without waiting for the timer
    if (this.cleanupTimer.unref) {
      this.cleanupTimer.unref()
    }
    // Symmetric teardown: Application.shutdown() drains the disposables
    // registry — without this, every in-process app re-create (tests, HMR)
    // leaked one live interval + its hits Map.
    registerDisposable(() => this.dispose())
  }

  /** Clear the cleanup interval and drop all hit counters. */
  dispose(): void {
    clearInterval(this.cleanupTimer)
    this.hits.clear()
  }

  async increment(key: string): Promise<{ totalHits: number; resetTime: Date }> {
    const now = Date.now()
    const entry = this.hits.get(key)

    if (entry && entry.resetTime.getTime() > now) {
      entry.totalHits++
      return { totalHits: entry.totalHits, resetTime: entry.resetTime }
    }

    const resetTime = new Date(now + this.windowMs)
    const newEntry: MemoryStoreEntry = { totalHits: 1, resetTime }
    this.hits.set(key, newEntry)
    return { totalHits: 1, resetTime }
  }

  async decrement(key: string): Promise<void> {
    const entry = this.hits.get(key)
    if (entry && entry.totalHits > 0) {
      entry.totalHits--
    }
  }

  async reset(key: string): Promise<void> {
    this.hits.delete(key)
  }

  private cleanup(): void {
    const now = Date.now()
    for (const [key, entry] of this.hits) {
      if (entry.resetTime.getTime() <= now) {
        this.hits.delete(key)
      }
    }
  }
}

/**
 * Rate limiting middleware.
 *
 * Limits the number of requests a client can make within a time window.
 * Uses an in-memory store by default, but accepts a custom store for
 * distributed deployments (e.g. Redis).
 *
 * @example
 * ```ts
 * import { rateLimit } from '@forinda/kickjs'
 *
 * bootstrap({
 *   modules,
 *   middlewares: [
 *     rateLimit({ max: 100, windowMs: 60_000 }),
 *     // ... other middleware
 *   ],
 * })
 * ```
 */
export function rateLimit(options: RateLimitOptions = {}) {
  const max = options.max ?? 100
  const windowMs = options.windowMs ?? 60_000
  const message = options.message ?? 'Too Many Requests'
  const statusCode = options.statusCode ?? 429
  // `req.ip` is Express-only. Under Fastify and h3 it is undefined, so EVERY
  // caller fell back to the same `'127.0.0.1'` literal — one shared bucket,
  // letting a single client exhaust the limit for everyone.
  const keyGenerator =
    options.keyGenerator ??
    ((req: Request) => resolveClientIp(req as ClientRequestLike) ?? 'global')
  const sendHeaders = options.headers ?? true
  const store = options.store ?? new MemoryStore(windowMs)
  const skip = options.skip
  const skipPaths = new Set(options.skipPaths ?? [])
  const exemptWhen = options.exemptWhen

  // Filled in by the Application once routes are mounted, via the slot
  // declared below. Absent when this middleware runs outside an Application
  // (a bare connect stack, a unit test) — `exemptWhen` then matches nothing,
  // which fails closed: everything stays limited.
  let policy: RoutePolicyTable | undefined

  const handler = async (req: Request, res: Response, next: NextFunction) => {
    // Skip if path is in the skip list
    // `req.path` is Express-only; `has(undefined)` never matched, so
    // configured skips were silently dead on the other runtimes.
    const pathname = resolvePathname(req as ClientRequestLike)
    if (skipPaths.has(pathname)) {
      return next()
    }

    // Flag exemption: ask the table what flags the matched route WOULD carry.
    // A request matching no route matches no flags and stays limited.
    if (exemptWhen !== undefined && policy) {
      const flags = policy.lookup(String(req.method ?? 'GET'), pathname)
      if (matchesFlagTest(exemptWhen, flags)) {
        return next()
      }
    }

    // Skip if the skip function returns true
    if (skip && skip(req)) {
      return next()
    }

    const key = keyGenerator(req)
    const { totalHits, resetTime } = await store.increment(key)
    const remaining = Math.max(0, max - totalHits)

    if (sendHeaders) {
      res.setHeader('RateLimit-Limit', max)
      res.setHeader('RateLimit-Remaining', remaining)
      res.setHeader('RateLimit-Reset', Math.ceil(resetTime.getTime() / 1000))
    }

    if (totalHits > max) {
      return sendJson(res, statusCode, { message })
    }

    next()
  }

  return bindRoutePolicy(handler, (table) => {
    policy = table
  })
}
