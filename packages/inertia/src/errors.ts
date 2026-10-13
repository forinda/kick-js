/**
 * Validation errors the Inertia way: on an Inertia request, a 422 from route
 * validation becomes a redirect back with the errors in the session, and the
 * next page gets them as `props.errors`. Everything else goes to the usual
 * error handler.
 *
 * @module @forinda/kickjs-inertia/errors
 */
import { errorHandler, HttpException, Logger, type RuntimeResponse } from '@forinda/kickjs'
import { ERRORS_KEY, previousUrl } from './inertia'

const log = Logger.for('Inertia')

type ErrorHandler = (
  err: any,
  req: any,
  res: RuntimeResponse,
  next: (err?: unknown) => void,
) => void

interface SessionLike {
  data: Record<string, unknown>
  save(): Promise<void>
}

/** `[{ field, message }]` from route validation → `{ field: firstMessage }`. */
function toErrors(details: unknown): Record<string, string> | null {
  if (!Array.isArray(details)) return null
  const errors: Record<string, string> = {}
  for (const d of details as Array<{ field?: string; message?: string }>) {
    const field = d.field || 'form'
    errors[field] ??= d.message ?? 'Invalid value'
  }
  return errors
}

/**
 * Pass to `bootstrap({ onError: inertiaErrorHandler() })`. Needs the
 * `session()` middleware to carry the errors to the next request.
 */
export function inertiaErrorHandler(fallback: ErrorHandler = errorHandler()): ErrorHandler {
  let warned = false
  return (err, req, res, next) => {
    const errors = err instanceof HttpException && err.status === 422 ? toErrors(err.details) : null
    if (!errors || req?.headers?.['x-inertia'] !== 'true' || res.headersSent) {
      return fallback(err, req, res, next)
    }
    const session = req.session as SessionLike | undefined
    if (!session) {
      if (!warned) {
        log.warn(
          'Validation failed on an Inertia request, but there is no session() middleware to carry the errors — answering 422 instead.',
        )
        warned = true
      }
      return fallback(err, req, res, next)
    }

    const bag = req.headers['x-inertia-error-bag'] as string | undefined
    session.data[ERRORS_KEY] = bag ? { [bag]: errors } : errors
    session
      .save()
      .then(() => {
        res.status(303).setHeader('location', previousUrl(session, req.headers))
        res.end()
      })
      .catch((saveErr) => fallback(saveErr, req, res, next))
  }
}
