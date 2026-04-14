import { Logger, type AppAdapter, type AdapterContext, Scope } from '@forinda/kickjs'
import { DRIZZLE_TENANT_DB, type DrizzleTenantAdapterOptions } from './types'

const log = Logger.for('DrizzleTenantAdapter')

/**
 * Multi-tenant Drizzle adapter — manages per-tenant database connections
 * with automatic caching and lifecycle management.
 *
 * Registers `DRIZZLE_TENANT_DB` as a TRANSIENT DI token that resolves
 * to the current tenant's Drizzle instance using AsyncLocalStorage
 * (requires `TenantAdapter` to be configured).
 *
 * Works alongside `DrizzleAdapter` — use `DRIZZLE_DB` for the provider
 * database and `DRIZZLE_TENANT_DB` for the current tenant's database.
 *
 * @example
 * ```ts
 * import { drizzle } from 'drizzle-orm/node-postgres'
 * import { Pool } from 'pg'
 * import * as schema from './schema'
 *
 * const providerDb = drizzle(new Pool({ connectionString: PROVIDER_URL }), { schema })
 *
 * bootstrap({
 *   adapters: [
 *     new TenantAdapter({ strategy: 'subdomain' }),
 *     new DrizzleTenantAdapter({
 *       providerDb,
 *       tenantFactory: async (tenantId) => {
 *         const url = await lookupTenantDbUrl(tenantId)
 *         return drizzle(new Pool({ connectionString: url }), { schema })
 *       },
 *     }),
 *   ],
 * })
 * ```
 *
 * Inject in services:
 * ```ts
 * @Service()
 * class ProjectService {
 *   constructor(@Inject(DRIZZLE_TENANT_DB) private db: NodePgDatabase<typeof schema>) {}
 * }
 * ```
 */
export class DrizzleTenantAdapter<TDb = unknown> implements AppAdapter {
  name = 'DrizzleTenantAdapter'
  private readonly providerDb: TDb
  private readonly tenantFactory: (tenantId: string) => TDb | Promise<TDb>
  private readonly connections = new Map<string, TDb>()
  private readonly options: DrizzleTenantAdapterOptions<TDb>

  constructor(options: DrizzleTenantAdapterOptions<TDb>) {
    this.options = options
    this.providerDb = options.providerDb
    this.tenantFactory = options.tenantFactory
  }

  /**
   * Get the database for a specific tenant.
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

  /** Register DRIZZLE_TENANT_DB as a transient factory in DI */
  async beforeStart({ container }: AdapterContext): Promise<void> {
    // Dynamically import getCurrentTenant to avoid hard dep on multi-tenant package
    let getCurrentTenant: (() => { id: string } | undefined) | undefined

    try {
      // @ts-expect-error optional peer dependency
      const mt = await import('@forinda/kickjs-multi-tenant')
      getCurrentTenant = mt.getCurrentTenant
    } catch {
      log.warn(
        'DrizzleTenantAdapter: @forinda/kickjs-multi-tenant not found. ' +
          'DRIZZLE_TENANT_DB will always resolve to the provider database.',
      )
    }

    container.registerFactory(
      DRIZZLE_TENANT_DB,
      () => {
        const tenant = getCurrentTenant?.()
        return this.getDb(tenant?.id)
      },
      Scope.TRANSIENT,
    )

    log.info(
      `Drizzle tenant DB registered (${getCurrentTenant ? 'multi-tenant mode' : 'provider-only mode'})`,
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
