import crypto from 'node:crypto'
import type { Request, Response, NextFunction } from 'express'
import { requestStore, type RequestStore } from '../request-store'
import { METADATA } from '../../core/interfaces'
import { getClassMetaOrUndefined } from '../../core/metadata'
import { createLogger } from '../../core/logger'

const log = createLogger('RequestScope')

// Per-class @PreDestroy method-name cache: the metadata is immutable after
// class definition, so pay the Reflect read once per class, not once per
// instance per request. `null` = "checked, none declared".
const preDestroyCache = new Map<Function, string | symbol | null>()

function preDestroyMethod(ctor: Function): string | symbol | null {
  let method = preDestroyCache.get(ctor)
  if (method === undefined) {
    method =
      getClassMetaOrUndefined<string | symbol>(METADATA.PRE_DESTROY, (ctor as any).prototype) ??
      null
    preDestroyCache.set(ctor, method)
  }
  return method
}

/**
 * Run `@PreDestroy` hooks on every REQUEST-scoped instance the request
 * created, then drop them. Called when the response closes (finished or
 * aborted) — the counterpart to `@PostConstruct`, closing the lifecycle gap
 * where per-request services holding transactions/handles/subscriptions were
 * silently dropped with no cleanup callback.
 *
 * Idempotent (guarded by `store.disposed`); hook errors are logged and
 * swallowed so one failing teardown can't break request completion. Async
 * hooks are fired without being awaited — the response is already gone.
 */
export function disposeRequestStore(store: RequestStore): void {
  if (store.disposed) return
  store.disposed = true
  if (store.instances.size === 0) return
  for (const instance of store.instances.values()) {
    if (instance === null || typeof instance !== 'object') continue
    const method = preDestroyMethod(instance.constructor)
    if (!method || typeof instance[method] !== 'function') continue
    try {
      const result = instance[method]()
      if (result && typeof result.then === 'function') {
        ;(result as Promise<void>).catch((err) =>
          log.error(err, `@PreDestroy on ${instance.constructor.name} rejected`),
        )
      }
    } catch (err) {
      log.error(err, `@PreDestroy on ${instance.constructor.name} threw`)
    }
  }
  store.instances.clear()
}

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
 * Build a fresh per-request store. Shared by {@link requestScopeMiddleware}
 * (Express) and by runtimes whose handler runs outside the connect-middleware
 * chain (e.g. Fastify), so both establish an identical ALS frame.
 */
export function createRequestStore(requestId?: string): RequestStore {
  return {
    requestId: requestId || crypto.randomUUID(),
    instances: new Map(),
    // Explicit generic locks the "string keys only" decision.
    values: new Map<string, unknown>(),
  }
}

/**
 * Wraps each request in an AsyncLocalStorage context.
 * Enables REQUEST-scoped DI and automatic requestId propagation to logs.
 *
 * Should be mounted early in the middleware pipeline (before route handlers).
 * `Application` mounts this automatically unless `contextStore: 'manual'` is set
 * or the user already includes one in their middleware list.
 */
export function requestScopeMiddleware() {
  const mw = (req: Request, res: Response, next: NextFunction) => {
    const requestIdHeader = req.headers['x-request-id']
    const requestId =
      (Array.isArray(requestIdHeader) ? requestIdHeader[0] : requestIdHeader) || crypto.randomUUID()
    const store = createRequestStore(requestId)
    // Surface the requestId on req so the standalone requestId() middleware
    // (when also mounted) reuses this value instead of generating a divergent
    // second one. Without this, log lines that read from the ALS store would
    // disagree with the X-Request-Id response header for any request that
    // didn't carry an inbound x-request-id header.
    ;(req as Request & { requestId?: string }).requestId = requestId
    // 'close' fires once the response finished OR the client aborted — run
    // @PreDestroy teardown for the request's scoped instances either way.
    res.once('close', () => disposeRequestStore(store))
    // Pass `next` directly — `run` invokes it with no args, so the arrow
    // wrapper previously allocated per request added nothing.
    requestStore.run(store, next)
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
