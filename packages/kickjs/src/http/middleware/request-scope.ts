import crypto from 'node:crypto'
import type { Request, Response, NextFunction } from 'express'
import { requestStore, type RequestStore } from '../request-store'

/**
 * Marker symbol stamped on the function returned by {@link requestScopeMiddleware}.
 *
 * `Application.setup()` uses {@link isRequestScopeMiddleware} to detect whether
 * the user-supplied middleware list already contains the request-scope wrapper,
 * and skips its automatic auto-mount when one is found. Lets adopters control
 * the exact position of the ALS frame in their pipeline (e.g., after a custom
 * tracing wrapper) without ending up with two nested frames.
 */
const REQUEST_SCOPE_MIDDLEWARE_MARKER: unique symbol = Symbol.for('@kickjs/requestScopeMiddleware')

/**
 * Wraps each request in an AsyncLocalStorage context.
 * Enables REQUEST-scoped DI and automatic requestId propagation to logs.
 *
 * Should be mounted early in the middleware pipeline (before route handlers).
 * `Application` mounts this automatically unless `contextStore: 'manual'` is set
 * or the user already includes one in their middleware list.
 */
export function requestScopeMiddleware() {
  const mw = (req: Request, _res: Response, next: NextFunction) => {
    const requestIdHeader = req.headers['x-request-id']
    const requestId =
      (Array.isArray(requestIdHeader) ? requestIdHeader[0] : requestIdHeader) || crypto.randomUUID()
    const store: RequestStore = {
      requestId,
      instances: new Map(),
      values: new Map(),
    }
    requestStore.run(store, () => next())
  }
  ;(mw as unknown as Record<symbol, unknown>)[REQUEST_SCOPE_MIDDLEWARE_MARKER] = true
  return mw
}

/**
 * Returns `true` when `value` is the function produced by {@link requestScopeMiddleware}.
 *
 * Detection uses a `Symbol.for(...)` marker so the check survives different
 * copies of `@forinda/kickjs` loaded under different module identities (e.g.,
 * a published package alongside a workspace-linked one during local dev).
 */
export function isRequestScopeMiddleware(value: unknown): boolean {
  if (typeof value !== 'function') return false
  return (value as unknown as Record<symbol, unknown>)[REQUEST_SCOPE_MIDDLEWARE_MARKER] === true
}
