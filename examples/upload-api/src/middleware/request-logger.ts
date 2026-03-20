import { createLogger } from '@forinda/kickjs-core'
import type { Request, Response, NextFunction } from 'express'

const log = createLogger('HTTP')

/**
 * Simple request logger middleware.
 * Shows how to create custom middleware that plugs into the pipeline.
 */
export function requestLogger() {
  return (req: Request, res: Response, next: NextFunction) => {
    const start = Date.now()

    res.on('finish', () => {
      const duration = Date.now() - start
      log.info(`${req.method} ${req.url} ${res.statusCode} ${duration}ms`)
    })

    next()
  }
}
