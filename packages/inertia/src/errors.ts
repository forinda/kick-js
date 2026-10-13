/**
 * Validation errors the Inertia way: on an Inertia request, a 422 from route
 * validation becomes a redirect back with the errors in the session, and the
 * next page gets them as `props.errors`. Everything else goes to the usual
 * error handler.
 *
 * @module @forinda/kickjs-inertia/errors
 */
import {
  errorHandler,
  HttpException,
  Logger,
  RequestContext,
  RESPOND,
  type RuntimeResponse,
} from '@forinda/kickjs'
import { ERRORS_KEY, errorPage, inertiaRuntime, isPageRequest, previousUrl } from './inertia'

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
 * Pass to `bootstrap({ onError: inertiaErrorHandler() })`.
 *
 * - A validation 422 on an Inertia visit goes back to the form with the
 *   errors (needs the `session()` middleware to carry them).
 * - Any other error on a page request renders the adapter's `errorPage`,
 *   when one is configured.
 * - Everything else — API calls, assets — goes to `fallback`.
 */
export function inertiaErrorHandler(fallback: ErrorHandler = errorHandler()): ErrorHandler {
  let warned = false
  return (err, req, res, next) => {
    if (res.headersSent) return fallback(err, req, res, next)

    const errors = err instanceof HttpException && err.status === 422 ? toErrors(err.details) : null
    if (errors && req?.headers?.['x-inertia'] === 'true') {
      const session = req.session as SessionLike | undefined
      if (session) {
        const bag = req.headers['x-inertia-error-bag'] as string | undefined
        session.data[ERRORS_KEY] = bag ? { [bag]: errors } : errors
        session
          .save()
          .then(() => {
            res.status(303).setHeader('location', previousUrl(session, req.headers))
            res.end()
          })
          .catch((saveErr) => fallback(saveErr, req, res, next))
        return
      }
      if (!warned) {
        log.warn(
          'Validation failed on an Inertia request, but there is no session() middleware to carry the errors — answering 422 instead.',
        )
        warned = true
      }
      return fallback(err, req, res, next)
    }

    const component = inertiaRuntime()?.errorPage
    if (component && req?.headers && isPageRequest(req.headers)) {
      const status = err instanceof HttpException ? err.status : 500
      if (status >= 500) log.error(err, 'Unhandled error on a page request')
      const ctx = new RequestContext(req, res as never, next, res)
      Promise.resolve(errorPage(component, status, err)[RESPOND](ctx)).catch((renderErr) =>
        fallback(renderErr, req, res, next),
      )
      return
    }
    return fallback(err, req, res, next)
  }
}

type NotFoundHandler = (req: any, res: RuntimeResponse, next: (err?: unknown) => void) => void

/**
 * Pass to `bootstrap({ onNotFound: inertiaNotFound() })`. A browser or Inertia
 * request for an unknown URL gets the adapter's `errorPage` with 404; anything
 * else — API calls, other methods — goes on to the built-in 404 / 405.
 */
export function inertiaNotFound(): NotFoundHandler {
  return (req, res, next) => {
    const component = inertiaRuntime()?.errorPage
    const method = req?.method ?? 'GET'
    if (
      !component ||
      (method !== 'GET' && method !== 'HEAD') ||
      !isPageRequest(req.headers ?? {})
    ) {
      return next()
    }
    const ctx = new RequestContext(req, res as never, next, res)
    Promise.resolve(errorPage(component, 404)[RESPOND](ctx)).catch(next)
  }
}
