import { AsyncLocalStorage } from 'node:async_hooks'
import type { MetaValue } from '../core/execution-context'

/** Per-request storage for REQUEST-scoped DI and request context propagation */
export interface RequestStore {
  /** Unique request identifier */
  requestId: string
  /**
   * Per-request singleton cache for REQUEST-scoped services. Keys are
   * heterogeneous (class constructors, `InjectionToken` objects, raw
   * strings), so the map type stays `Map<any, any>`.
   */
  instances: Map<any, any>
  /**
   * Per-request key/value bag. Canonical backing store for
   * `RequestContext.set/get` and the Context Contributor pipeline (#107)
   * since Phase 3. Anything written here is visible to every concrete
   * execution context constructed for the same request, regardless of
   * which middleware/contributor wrote it.
   *
   * Keys are constrained to `string` per the locked decision in
   * `architecture.md` §20.12 (#4); the value type is `unknown` because
   * the concrete shape at each key is determined by the consumer's
   * `ContextMeta` augmentation, not by the store itself.
   *
   * Prefer the {@link getRequestValue} helper over reaching into this
   * map directly — it threads the augmented `ContextMeta` shape through
   * `MetaValue<K>` so consumers get typed reads without an `as` cast.
   * Writes should flow through `ctx.set(key, value)` or a Context
   * Contributor's return value — see the `setRequestValue` note below
   * for why this package intentionally does NOT ship a service-level
   * write helper.
   */
  values: Map<string, unknown>
}

/** AsyncLocalStorage instance shared across the framework */
export const requestStore = new AsyncLocalStorage<RequestStore>()

/**
 * Get the current request store. Throws if called outside a request context.
 * Used by the Container to resolve REQUEST-scoped dependencies.
 */
export function getRequestStore(): RequestStore {
  const store = requestStore.getStore()
  if (!store) {
    throw new Error(
      'No active request context. REQUEST-scoped services can only be resolved during an HTTP request.',
    )
  }
  return store
}

/**
 * Read a per-request `ContextMeta`-keyed value from outside a controller
 * (services, repositories, anywhere with no `ctx` reference). Returns
 * the augmented type for the key — `MetaValue<K>` — so consumers get the
 * same static safety as `ctx.get(key)` without holding the context.
 *
 * Returns `undefined` outside an active request frame (background jobs,
 * startup code, tests without `requestScopeMiddleware()`) — the helper
 * is intentionally null-tolerant so calling it from a service that
 * runs in both request and non-request paths doesn't throw.
 *
 * @example
 * ```ts
 * declare module '@forinda/kickjs' {
 *   interface ContextMeta { tenant: { id: string; name: string } }
 * }
 *
 * @Service()
 * class AuditService {
 *   log(action: string) {
 *     const tenant = getRequestValue('tenant')  // typed: { id; name } | undefined
 *     db.audit.insert({ action, tenantId: tenant?.id })
 *   }
 * }
 * ```
 */
export function getRequestValue<K extends string>(key: K): MetaValue<K> | undefined {
  return requestStore.getStore()?.values.get(key) as MetaValue<K> | undefined
}

// Intentionally NO `setRequestValue` export.
//
// Writes are deliberately context-scoped — only the controlled write
// surfaces should mutate the per-request Map:
//
//   1. A Context Contributor's `resolve()` / `onError()` return value
//      (the runner does `ctx.set(reg.key, value)` on the contributor's
//      behalf). This is the canonical way to populate a key.
//   2. A controller / middleware / contributor that holds a
//      `RequestContext` instance can call `ctx.set(key, value)`
//      directly. The write is auditable inline at the call site.
//
// Letting arbitrary services reach in and mutate the store from
// anywhere produces "spooky action at a distance" — keys appear in
// the request bag without an obvious source, and tracing which
// service polluted what becomes a grep exercise. Services that need
// to publish per-request state should return the value to the caller
// (controller or contributor) and let *that* layer write it via
// `ctx.set`. If a future need genuinely requires a service-level
// write surface, expose a narrow function (`recordTrace`,
// `markStartTime`) on a service that captures the side effect, not a
// generic `setRequestValue`.
