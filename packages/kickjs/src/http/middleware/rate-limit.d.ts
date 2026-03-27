import type { Request, Response, NextFunction } from 'express'
export interface RateLimitStore {
  increment(key: string): Promise<{
    totalHits: number
    resetTime: Date
  }>
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
/**
 * Rate limiting middleware.
 *
 * Limits the number of requests a client can make within a time window.
 * Uses an in-memory store by default, but accepts a custom store for
 * distributed deployments (e.g. Redis).
 *
 * @example
 * ```ts
 * import { rateLimit } from '@forinda/kickjs-http'
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
export declare function rateLimit(
  options?: RateLimitOptions,
): (
  req: Request,
  res: Response,
  next: NextFunction,
) => Promise<void | Response<any, Record<string, any>>>
//# sourceMappingURL=rate-limit.d.ts.map
