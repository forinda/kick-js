import { createLogger } from '@forinda/kickjs-core'
import type { Request, Response, NextFunction } from 'express'

const log = createLogger('HTTP')

/**
 * Request logging middleware.
 *
 * Logs method, URL, status code, and duration for every request.
 * Uses the framework's structured logger (pino) so output is
 * JSON in production and pretty-printed in development.
 */
export function requestLogger() {
  return (req: Request, res: Response, next: NextFunction) => {
    const start = Date.now()

    res.on('finish', () => {
      const duration = Date.now() - start
      const requestId = (req as any).requestId || req.headers['x-request-id'] || '-'
      log.info(`${req.method} ${req.originalUrl} ${res.statusCode} ${duration}ms [${requestId}]`)
    })

    next()
  }
}
