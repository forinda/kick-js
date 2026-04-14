import { AsyncLocalStorage } from 'node:async_hooks'
import type { TenantInfo } from './types'

/**
 * AsyncLocalStorage instance that holds the current request's tenant.
 * Used internally by TenantAdapter to make tenant resolution request-scoped.
 */
export const tenantStorage = new AsyncLocalStorage<TenantInfo>()

/**
 * Get the current request's tenant from AsyncLocalStorage.
 *
 * Returns `undefined` when called outside a request scope (e.g.,
 * during startup, in a background job, or in tests without setup).
 *
 * @example
 * ```ts
 * import { getCurrentTenant } from '@forinda/kickjs-multi-tenant'
 *
 * function logForTenant(message: string) {
 *   const tenant = getCurrentTenant()
 *   console.log(`[${tenant?.id ?? 'no-tenant'}] ${message}`)
 * }
 * ```
 */
export function getCurrentTenant(): TenantInfo | undefined {
  return tenantStorage.getStore()
}
