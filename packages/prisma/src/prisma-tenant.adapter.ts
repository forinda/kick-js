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
  private readonly lastAccessed = new Map<string, number>()
  private readonly options: PrismaTenantAdapterOptions<TDb>
  private readonly evictionTimer?: ReturnType<typeof setInterval>

  constructor(options: PrismaTenantAdapterOptions<TDb>) {
    this.options = options
    this.providerDb = options.providerDb
    this.tenantFactory = options.tenantFactory

    if (options.cacheTtl && options.cacheTtl > 0) {
      const interval = Math.min(options.cacheTtl, 60_000)
      this.evictionTimer = setInterval(() => this.evictStale(), interval)
      this.evictionTimer.unref()
    }
  }

  /**
   * Get the PrismaClient for a specific tenant.
   * Creates and caches the connection on first access.
   * Returns the provider DB when tenantId is undefined/null.
   */
  async getDb(tenantId?: string | null): Promise<TDb> {
    if (!tenantId) return this.providerDb

    const cached = this.connections.get(tenantId)
    if (cached) {
      this.lastAccessed.set(tenantId, Date.now())
      return cached
    }

    const db = await this.tenantFactory(tenantId)
    this.connections.set(tenantId, db)
    this.lastAccessed.set(tenantId, Date.now())

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
      const mt: any = await import('@forinda/kickjs-multi-tenant')
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

  /** Evict connections that haven't been accessed within cacheTtl */
  private async evictStale(): Promise<void> {
    const ttl = this.options.cacheTtl
    if (!ttl) return

    const now = Date.now()
    for (const [tenantId, lastTime] of this.lastAccessed) {
      if (now - lastTime > ttl) {
        const db = this.connections.get(tenantId)
        if (db && this.options.onTenantShutdown) {
          try {
            await this.options.onTenantShutdown(db, tenantId)
          } catch (err) {
            log.error(`Failed to evict tenant DB ${tenantId}: ${err}`)
          }
        }
        this.connections.delete(tenantId)
        this.lastAccessed.delete(tenantId)

        if (this.options.logging) {
          log.info(`Tenant DB evicted (idle): ${tenantId}`)
        }
      }
    }
  }

  /** Close all tenant connections on shutdown */
  async shutdown(): Promise<void> {
    if (this.evictionTimer) clearInterval(this.evictionTimer)

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
    this.lastAccessed.clear()
    log.info('All tenant DB connections closed')
  }

  /** Number of cached tenant connections (useful for monitoring) */
  get connectionCount(): number {
    return this.connections.size
  }
}
