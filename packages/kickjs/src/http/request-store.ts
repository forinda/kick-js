import { AsyncLocalStorage } from 'node:async_hooks'

/** Per-request storage for REQUEST-scoped DI and request context propagation */
export interface RequestStore {
  /** Unique request identifier */
  requestId: string
  /** Per-request singleton cache for REQUEST-scoped services */
  instances: Map<any, any>
  /**
   * Per-request key/value bag. Canonical backing store for
   * `RequestContext.set/get` and the Context Contributor pipeline (#107)
   * since Phase 3. Anything written here is visible to every concrete
   * execution context constructed for the same request, regardless of
   * which middleware/contributor wrote it.
   */
  values: Map<any, any>
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
