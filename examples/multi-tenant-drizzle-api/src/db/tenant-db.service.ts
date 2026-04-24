import { Service, getRequestValue } from '@forinda/kickjs'
import { tenantManager, type SimulatedDb } from './tenant-manager'

/**
 * Injectable service that resolves the current tenant's database.
 *
 * In production with real Drizzle:
 *   export type TenantDb = NodePgDatabase<typeof schema>
 *   async current(): Promise<TenantDb> { ... }
 *
 * Controllers and services use this instead of calling tenantManager directly.
 *
 * The active tenant is populated by the `LoadTenant` Context Contributor
 * (see `src/contributors/tenant.context.ts`) and read here via
 * `getRequestValue('tenant')`.
 */
@Service()
export class TenantDbService {
  async current(): Promise<SimulatedDb> {
    const tenant = getRequestValue('tenant')
    return tenantManager.getDb(tenant?.id)
  }
}
