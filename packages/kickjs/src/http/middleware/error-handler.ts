import type { RuntimeResponse } from '../runtime'

/**
 * The slice of the request this handler reads, spelled from node's
 * `IncomingMessage` rather than Express's `Request`.
 *
 * Fastify and h3 hand the error handler `request.raw` — a plain
 * `IncomingMessage` — so anything Express-only is `undefined` there. This is
 * the default handler for EVERY runtime, so it must not assume Express.
 */
interface ErrorRequest {
  method?: string
  url?: string
  /** Express-only; absent on the raw node request the other runtimes pass. */
  originalUrl?: string
  headers: Record<string, string | string[] | undefined>
}
// Module paths, not the core barrel: the web entry (edge runtimes) uses these
// handlers too, and the barrel reaches node-only modules.
import { HttpException, ProblemException, normalizeProblem } from '../../core/errors'
import { createLogger, describeError } from '../../core/logger'
import { isProduction as isProductionEnv } from '../../core/is-production'

const log = createLogger('ErrorHandler')

/** A mounted route, as the catch-all needs to see it. */
export interface MountedRoute {
  method: string
  /** Full path as mounted, `:param` segments included. */
  path: string
}

/** `/things/:id` → `^/things/[^/]+$`, so a concrete path can be matched. */
function patternToRegExp(pattern: string): RegExp {
  const source = pattern
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\/:[^/]+/g, '/[^/]+')
    .replace(/\*/g, '.*')
  return new RegExp(`^${source}/?$`)
}

/** Path without query string or hash. */
function pathOf(req: ErrorRequest): string {
  const url = req.originalUrl ?? req.url ?? '/'
  const cut = url.search(/[?#]/)
  return cut === -1 ? url : url.slice(0, cut)
}

/**
 * Catch-all for unmatched routes.
 *
 * Answers RFC 9457 problem details, like every other error the framework
 * produces — the catch-all was the one path still emitting a bare
 * `{ message }`, so a client parsing `application/problem+json` had to special
 * case it.
 *
 * Distinguishes a path that does not exist from a path that does not accept
 * this method. `DELETE /things/1` where only `GET` is mounted is a **405** with
 * an `Allow` header, not a 404: the resource is there, the verb is not, and
 * 404 tells a client to stop looking for something that exists. Requires the
 * mounted route table, so an app that does not pass one keeps answering 404.
 */
export function notFoundHandler(routes: readonly MountedRoute[] = []) {
  const matchers = routes.map((route) => ({
    method: route.method.toUpperCase(),
    matches: patternToRegExp(route.path),
  }))

  return (req: ErrorRequest, res: RuntimeResponse, _next: () => void) => {
    const path = pathOf(req)
    const method = (req.method ?? 'GET').toUpperCase()
    const allowed = [...new Set(matchers.filter((m) => m.matches.test(path)).map((m) => m.method))]

    if (allowed.length > 0 && !allowed.includes(method)) {
      // Sorted once: the header and the detail must list the same verbs in the
      // same order, and `sort()` would mutate `allowed` under the second read.
      const verbs = allowed.toSorted().join(', ')
      // RFC 9110 §15.5.6 requires Allow on a 405.
      res.setHeader('Allow', verbs)
      res.setHeader('Content-Type', 'application/problem+json')
      return res.status(405).json(
        normalizeProblem({
          status: 405,
          detail: `${method} is not supported for this resource. Allowed: ${verbs}.`,
        }),
      )
    }

    res.setHeader('Content-Type', 'application/problem+json')
    return res.status(404).json(normalizeProblem({ status: 404 }))
  }
}

/**
 * A validation failure's `[{ field, message }]` with every other member
 * dropped — or `undefined` when `details` isn't that shape.
 */
function fieldErrors(details: unknown): Array<{ field: string; message: string }> | undefined {
  if (!Array.isArray(details) || details.length === 0) return undefined
  const ok = details.every((d) => typeof d?.field === 'string' && typeof d?.message === 'string')
  return ok ? details.map((d) => ({ field: d.field, message: d.message })) : undefined
}

/**
 * Global error handler.
 *
 * Default behavior strips error `details` from the response in production
 * (any `NODE_ENV` but `development` / `test`, unset included) so internal
 * context (DB errors, custom payloads) does not leak to clients. A 422's
 * per-field `{ field, message }` list is kept — field names and messages are
 * what a form shows — with every other member dropped. Apps that want a
 * different policy pass their own `onError` to `bootstrap()`.
 *
 * Unexpected 500s carry `requestId` in every environment (the correlation
 * handle back to the log line) and, outside production, the error summary
 * plus stack. Production bodies stay opaque.
 *
 * {@link ProblemException} and plain {@link HttpException} both emit
 * `application/problem+json` per RFC 9457. `ProblemException` carries a
 * caller-supplied `type` / `title` / extensions; an `HttpException`'s message
 * becomes `detail`, with `title` and `type` defaulted from the status. One
 * shape, so a client never has to branch on which one the app threw.
 */
export function errorHandler() {
  return (err: any, req: ErrorRequest, res: RuntimeResponse, _next: () => void) => {
    const isProduction = isProductionEnv()
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

    // A raw ZodError never comes from the framework's own validation (that
    // raises an HttpException 422 with `[{ field, message }]`). It is the app
    // parsing something — possibly internal data — so production shows no
    // field paths; route validation (`@Post('/', { body })`) or an explicit
    // `HttpException` is how a form gets its field errors.
    if (err?.name === 'ZodError') {
      const firstIssue = err.issues?.[0]
      return res.status(422).json({
        message: firstIssue?.message || 'Validation failed',
        ...(isProduction ? {} : { errors: err.issues }),
      })
    }

    // HttpException (expected application errors) — RFC 9457, same as
    // ProblemException. It used to answer a bare `{ message }`, which made it
    // THE path a client parsing `application/problem+json` had to special-case
    // (#611) — the exact situation #587 removed from the catch-all. The
    // message becomes `detail`; `title` and `type` default from the status.
    if (err instanceof HttpException) {
      if (err.status >= 500) {
        log.error(err, err.message)
      }
      if (err.headers) {
        for (const [k, v] of Object.entries(err.headers)) {
          res.setHeader(k, v)
        }
      }
      // Extension member, permitted by RFC 9457 §3.2. Held back in production:
      // `details` can carry the shape of the request that failed. A 422's
      // per-field `{ field, message }` list is the exception — a form needs
      // it to say which field is wrong — so production keeps just those two.
      const errors = isProduction
        ? err.status === 422
          ? fieldErrors(err.details)
          : undefined
        : err.details
      res.setHeader('Content-Type', 'application/problem+json')
      return res.status(err.status).json(
        normalizeProblem({
          status: err.status,
          detail: err.message,
          ...(errors !== undefined ? { errors } : {}),
        }),
      )
    }

    const requestId = (req as any).requestId ?? req.headers['x-request-id']
    const declared = Number(err.status ?? err.statusCode)

    // Any error that says it's a client error — a database UniqueViolationError
    // (409), a BYO auth check's 401 — is answered like an HttpException: RFC
    // 9457, its message as `detail`, and a warning rather than an error log.
    // It used to fall through to the catch-all: logged at ERROR with a stack,
    // answered with a bare `{ message }` no problem+json client could parse.
    if (Number.isInteger(declared) && declared >= 400 && declared < 500) {
      log.warn(`${req.method} ${req.originalUrl ?? req.url} — ${declared} ${describeError(err)}`)
      res.setHeader('Content-Type', 'application/problem+json')
      return res.status(declared).json(
        normalizeProblem({
          status: declared,
          detail: err.message || undefined,
          ...(requestId ? { requestId } : {}),
        }),
      )
    }

    // Unexpected errors — always log. A declared 5xx keeps its status but
    // gets the same guarded body as a 500.
    const status = Number.isInteger(declared) && declared >= 500 && declared < 600 ? declared : 500
    log.error(
      err,
      // `originalUrl` is Express-only. Fastify and h3 pass `request.raw`, so
      // this logged `GET undefined — <error>` on every error under those
      // runtimes — the path silently dropped from the one line meant to
      // identify the failing request.
      `${req.method} ${req.originalUrl ?? req.url} — ${describeError(err)}${
        requestId ? ` [${requestId}]` : ''
      }`,
    )

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
    res.status(status).json({
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
