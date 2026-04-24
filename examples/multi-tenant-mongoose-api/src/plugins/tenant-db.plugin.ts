import { createToken, definePlugin, getRequestValue, Scope } from '@forinda/kickjs'
import { tenantManager, type SimulatedDb } from '../db/tenant-manager'

/**
 * Token for the request-scoped, tenant-resolved database connection.
 *
 * The simulated tenant manager caches connections lazily, so the factory
 * returns a `Promise<SimulatedDb>`. In production with real Mongoose the
 * cache is populated up front and the factory returns
 * `mongoose.Connection` synchronously.
 */
export const TENANT_DB = createToken<Promise<SimulatedDb>>('app/db/tenant')

/**
 * Replaces the deprecated `@forinda/kickjs-multi-tenant` adapter's
 * per-request DB switching. The factory runs once per request thanks to
 * `Scope.REQUEST` — every service that injects `TENANT_DB` shares the
 * same instance for that request.
 */
export const TenantDbPlugin = definePlugin({
  name: 'TenantDbPlugin',
  build: () => ({
    register(container) {
      container.registerFactory(
        TENANT_DB,
        () => {
          const tenant = getRequestValue('tenant')
          return tenantManager.getDb(tenant?.id)
        },
        Scope.REQUEST,
      )
    },
  }),
})
