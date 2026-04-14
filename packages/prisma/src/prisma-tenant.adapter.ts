import { Logger, type AppAdapter, type AdapterContext, Scope } from '@forinda/kickjs'
import { PRISMA_TENANT_CLIENT, type PrismaTenantAdapterOptions } from './types'

const log = Logger.for('PrismaTenantAdapter')

/**
 * Multi-tenant Prisma adapter — manages per-tenant PrismaClient connections
 * with automatic caching and lifecycle management.
 *
 * Registers `PRISMA_TENANT_CLIENT` as a TRANSIENT DI token that resolves
 * to the current tenant's PrismaClient using AsyncLocalStorage
 * (requires `TenantAdapter` to be configured).
 *
 * Works alongside `PrismaAdapter` — use `PRISMA_CLIENT` for the provider
 * database and `PRISMA_TENANT_CLIENT` for the current tenant's database.
 *
 * @example
 * ```ts
 * import { PrismaClient } from '@prisma/client'
 *
 * const providerDb = new PrismaClient({ datasourceUrl: PROVIDER_URL })
 *
 * bootstrap({
 *   adapters: [
 *     new TenantAdapter({ strategy: 'subdomain' }),
 *     new PrismaTenantAdapter({
 *       providerDb,
 *       tenantFactory: async (tenantId) => {
 *         const url = await lookupTenantDbUrl(tenantId)
 *         return new PrismaClient({ datasourceUrl: url })
 *       },
 *       onTenantShutdown: (db) => db.$disconnect(),
 *     }),
 *   ],
 * })
 * ```
 *
 * Inject in services:
 * ```ts
 * @Service()
 * class ProjectService {
 *   constructor(@Inject(PRISMA_TENANT_CLIENT) private prisma: PrismaClient) {}
 * }
 * ```
 */
export class PrismaTenantAdapter<TDb = unknown> implements AppAdapter {
  name = 'PrismaTenantAdapter'
  private readonly providerDb: TDb
  private readonly tenantFactory: (tenantId: string) => TDb | Promise<TDb>
  private readonly connections = new Map<string, TDb>()
  private readonly options: PrismaTenantAdapterOptions<TDb>

  constructor(options: PrismaTenantAdapterOptions<TDb>) {
    this.options = options
    this.providerDb = options.providerDb
    this.tenantFactory = options.tenantFactory
  }

  /**
   * Get the PrismaClient for a specific tenant.
   * Creates and caches the connection on first access.
   * Returns the provider DB when tenantId is undefined/null.
   */
  async getDb(tenantId?: string | null): Promise<TDb> {
    if (!tenantId) return this.providerDb

    const cached = this.connections.get(tenantId)
    if (cached) return cached

    const db = await this.tenantFactory(tenantId)
    this.connections.set(tenantId, db)

    if (this.options.logging) {
      log.info(`Tenant DB created: ${tenantId} (${this.connections.size} total)`)
    }

    return db
  }

  /** Register PRISMA_TENANT_CLIENT as a transient factory in DI */
  async beforeStart({ container }: AdapterContext): Promise<void> {
    // Dynamically import getCurrentTenant to avoid hard dep on multi-tenant package
    let getCurrentTenant: (() => { id: string } | undefined) | undefined

    try {
      // @ts-expect-error optional peer dependency
      const mt = await import('@forinda/kickjs-multi-tenant')
      getCurrentTenant = mt.getCurrentTenant
    } catch {
      log.warn(
        'PrismaTenantAdapter: @forinda/kickjs-multi-tenant not found. ' +
          'PRISMA_TENANT_CLIENT will always resolve to the provider database.',
      )
    }

    container.registerFactory(
      PRISMA_TENANT_CLIENT,
      () => {
        const tenant = getCurrentTenant?.()
        return this.getDb(tenant?.id)
      },
      Scope.TRANSIENT,
    )

    log.info(
      `Prisma tenant DB registered (${getCurrentTenant ? 'multi-tenant mode' : 'provider-only mode'})`,
    )
  }

  /** Close all tenant connections on shutdown */
  async shutdown(): Promise<void> {
    if (this.options.onTenantShutdown) {
      for (const [tenantId, db] of this.connections) {
        try {
          await this.options.onTenantShutdown(db, tenantId)
        } catch (err) {
          log.error(`Failed to close tenant DB ${tenantId}: ${err}`)
        }
      }
    }

    this.connections.clear()
    log.info('All tenant DB connections closed')
  }

  /** Number of cached tenant connections (useful for monitoring) */
  get connectionCount(): number {
    return this.connections.size
  }
}
