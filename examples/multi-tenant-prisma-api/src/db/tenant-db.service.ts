import { Service } from '@forinda/kickjs'
import { getCurrentTenant } from '@forinda/kickjs-multi-tenant'
import { tenantManager, type SimulatedDb } from './tenant-manager'

/**
 * Injectable service that resolves the current tenant's database.
 *
 * In production with real Prisma:
 *   export type TenantDb = PrismaClient
 *   async current(): Promise<TenantDb> { ... }
 *
 * Controllers and services use this instead of calling tenantManager directly.
 */
@Service()
export class TenantDbService {
  async current(): Promise<SimulatedDb> {
    const tenant = getCurrentTenant()
    return tenantManager.getDb(tenant?.id)
  }
}
