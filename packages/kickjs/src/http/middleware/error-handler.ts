import type { Request, Response, NextFunction } from 'express'
import { HttpException, createLogger } from '../../core'

const log = createLogger('ErrorHandler')

/** Catch-all for unmatched routes */
export function notFoundHandler() {
  return (_req: Request, res: Response, _next: NextFunction) => {
    res.status(404).json({ message: 'Not Found' })
  }
}

/**
 * Global error handler.
 *
 * Default behavior strips error `details` from the response in production
 * (NODE_ENV === 'production') so internal context (DB errors, validation
 * issues, custom payloads) does not leak to clients. Apps that want to
 * expose details in production — for client-facing field-level validation,
 * for example — should pass their own `onError` to `bootstrap()` and decide
 * the policy explicitly.
 */
export function errorHandler() {
  const isProduction = process.env.NODE_ENV === 'production'
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
        ...(isProduction ? {} : { errors: err.issues }),
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
      const exposeDetails = !isProduction && err.details !== undefined
      return res.status(err.status).json({
        message: err.message,
        ...(exposeDetails ? { errors: err.details } : {}),
      })
    }

    // Unexpected errors — always log
    const status = err.status || err.statusCode || 500
    log.error(err, `${req.method} ${req.originalUrl} — ${err.message || 'Unhandled error'}`)
    const message = status === 500 ? 'Internal Server Error' : err.message || 'Error'
    res.status(status).json({ message })
  }
}
