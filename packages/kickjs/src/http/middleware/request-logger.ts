import type { Request, Response, NextFunction } from 'express'
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

  return (req: Request, res: Response, next: NextFunction) => {
    // Skip logging for excluded paths
    if (skip.some((prefix) => req.path.startsWith(prefix))) {
      return next()
    }

    const start = Date.now()

    res.on('finish', () => {
      const duration = Date.now() - start
      const requestId = (req as any).requestId || req.headers['x-request-id'] || '-'
      const status = res.statusCode

      log[level](`${req.method} ${req.originalUrl} ${status} ${duration}ms ${requestId}`)
    })

    next()
  }
}
