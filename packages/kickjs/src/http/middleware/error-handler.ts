import type { Request, Response, NextFunction } from 'express'
import { HttpException, createLogger } from '../../core'

const log = createLogger('ErrorHandler')

/** Catch-all for unmatched routes */
export function notFoundHandler() {
  return (_req: Request, res: Response, _next: NextFunction) => {
    res.status(404).json({ message: 'Not Found' })
  }
}

/** Global error handler */
export function errorHandler() {
  return (err: any, req: Request, res: Response, _next: NextFunction) => {
    // Don't write after headers are already sent
    if (res.headersSent) {
      log.warn(`Error after headers sent: ${err?.message || 'Unknown'}`)
      return
    }

    // Zod validation errors
    if (err?.name === 'ZodError') {
      const firstIssue = err.issues?.[0]
      return res.status(422).json({
        message: firstIssue?.message || 'Validation failed',
        errors: err.issues,
      })
    }

    // HttpException (expected application errors)
    if (err instanceof HttpException) {
      if (err.status >= 500) {
        log.error(err, err.message)
      }
      if (err.headers) {
        for (const [k, v] of Object.entries(err.headers)) {
          res.setHeader(k, v)
        }
      }
      return res.status(err.status).json({
        message: err.message,
        ...(err.details !== undefined ? { errors: err.details } : {}),
      })
    }

    // Unexpected errors — always log
    const status = err.status || err.statusCode || 500
    log.error(err, `${req.method} ${req.originalUrl} — ${err.message || 'Unhandled error'}`)
    const message = status === 500 ? 'Internal Server Error' : err.message || 'Error'
    res.status(status).json({ message })
  }
}
