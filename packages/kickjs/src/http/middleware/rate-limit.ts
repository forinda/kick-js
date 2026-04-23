import type { Request, Response, NextFunction } from 'express'

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
 *   middleware: [
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
  const keyGenerator = options.keyGenerator ?? ((req: Request) => req.ip ?? '127.0.0.1')
  const sendHeaders = options.headers ?? true
  const store = options.store ?? new MemoryStore(windowMs)
  const skip = options.skip
  const skipPaths = new Set(options.skipPaths ?? [])

  return async (req: Request, res: Response, next: NextFunction) => {
    // Skip if path is in the skip list
    if (skipPaths.has(req.path)) {
      return next()
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
      return res.status(statusCode).json({ message })
    }

    next()
  }
}
