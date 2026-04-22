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
// `Symbol.for(...)` returns a plain `symbol` (not `unique symbol`), but the
// runtime detection marker doesn't need the unique nominal property — it only
// needs the interned-slot reference equality that `Symbol.for` already provides.
const REQUEST_SCOPE_MIDDLEWARE_MARKER = Symbol.for('@kickjs/requestScopeMiddleware')

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
      // Explicit generic locks the "string keys only" decision
      // (architecture.md §20.12 #4) at construction time, so accidental
      // non-string keys can't slip in via the inferred Map<any, any>.
      values: new Map<string, unknown>(),
    }
    // Surface the requestId on req so the standalone requestId() middleware
    // (when also mounted) reuses this value instead of generating a divergent
    // second one. Without this, log lines that read from the ALS store would
    // disagree with the X-Request-Id response header for any request that
    // didn't carry an inbound x-request-id header.
    ;(req as Request & { requestId?: string }).requestId = requestId
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
