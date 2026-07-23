import type { Request, Response, NextFunction } from 'express'
import {
  HttpException,
  ProblemException,
  normalizeProblem,
  createLogger,
  describeError,
} from '../../core'

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
 *
 * Unexpected 500s carry `requestId` in every environment (the correlation
 * handle back to the log line) and, outside production, the error summary
 * plus stack. Production bodies stay opaque.
 *
 * {@link ProblemException} is dispatched first and emits an
 * `application/problem+json` response per RFC 9457. Plain
 * {@link HttpException} keeps the existing `{ message, errors? }` shape
 * for backward compatibility.
 */
export function errorHandler() {
  const isProduction = process.env.NODE_ENV === 'production'
  return (err: any, req: Request, res: Response, _next: NextFunction) => {
    // Don't write after headers are already sent
    if (res.headersSent) {
      log.warn(`Error after headers sent: ${err?.message || 'Unknown'}`)
      return
    }

    // RFC 9457 Problem Details — checked before HttpException because
    // ProblemException extends HttpException; instanceof on the base
    // would otherwise swallow it.
    if (err instanceof ProblemException) {
      if (err.problem.status >= 500) {
        log.error(err, err.message)
      }
      if (err.headers) {
        for (const [k, v] of Object.entries(err.headers)) {
          res.setHeader(k, v)
        }
      }
      const body = normalizeProblem(err.problem)
      res.setHeader('Content-Type', 'application/problem+json')
      return res.status(body.status).json(body)
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
    const requestId = (req as any).requestId ?? req.headers['x-request-id']
    log.error(
      err,
      `${req.method} ${req.originalUrl} — ${describeError(err)}${
        requestId ? ` [${requestId}]` : ''
      }`,
    )

    if (status !== 500) {
      return res.status(status).json({
        message: err.message || 'Error',
        ...(requestId ? { requestId } : {}),
      })
    }

    // A 500 body must never carry the raw error in production — it can
    // contain table names, SQL, connection strings, or user data. But
    // returning a bare `{ message: 'Internal Server Error' }` in
    // development means the one place a developer is looking tells them
    // nothing, and the failure has to be re-diagnosed from the database.
    //
    // Development gets the full picture. Production gets the requestId,
    // which is the correlation handle back to the (now stack-carrying)
    // log line — without it an opaque 500 can't even be tied to its own
    // log entry.
    res.status(500).json({
      message: 'Internal Server Error',
      ...(requestId ? { requestId } : {}),
      ...(isProduction
        ? {}
        : {
            error: describeError(err),
            ...(typeof err?.stack === 'string' ? { stack: err.stack.split('\n') } : {}),
          }),
    })
  }
}
