import { Logger, defineAdapter, Scope, getRequestValue } from '@forinda/kickjs'
import { PRISMA_TENANT_CLIENT, type PrismaTenantAdapterOptions } from './types'

const log = Logger.for('PrismaTenantAdapter')

/**
 * Public extension methods exposed by a PrismaTenantAdapter instance.
 * `getDb()` returns the (possibly newly-created) PrismaClient for a
 * tenant; `connectionCount` reports the cache size for monitoring.
 */
export interface PrismaTenantAdapterExtensions<TDb = unknown> {
  /**
   * Get the PrismaClient for a specific tenant. Creates and caches the
   * connection on first access. Returns the provider DB when tenantId
   * is undefined/null.
   */
  getDb(tenantId?: string | null): Promise<TDb>
  /** Number of cached tenant connections (useful for monitoring). */
  readonly connectionCount: number
}

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
 *     TenantAdapter({ strategy: 'subdomain' }),
 *     PrismaTenantAdapter({
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
export const PrismaTenantAdapter = defineAdapter<
  PrismaTenantAdapterOptions<unknown>,
  PrismaTenantAdapterExtensions<unknown>
>({
  name: 'PrismaTenantAdapter',
  build: (options) => {
    const providerDb = options.providerDb
    const tenantFactory = options.tenantFactory
    const connections = new Map<string, unknown>()
    const lastAccessed = new Map<string, number>()
    let evictionTimer: ReturnType<typeof setInterval> | undefined

    if (options.cacheTtl && options.cacheTtl > 0) {
      const interval = Math.min(options.cacheTtl, 60_000)
      evictionTimer = setInterval(() => evictStale(), interval)
      evictionTimer.unref()
    }

    /** Get the PrismaClient for a specific tenant. */
    const getDb = async (tenantId?: string | null): Promise<unknown> => {
      if (!tenantId) return providerDb

      const cached = connections.get(tenantId)
      if (cached) {
        lastAccessed.set(tenantId, Date.now())
        return cached
      }

      const db = await tenantFactory(tenantId)
      connections.set(tenantId, db)
      lastAccessed.set(tenantId, Date.now())

      if (options.logging) {
        log.info(`Tenant DB created: ${tenantId} (${connections.size} total)`)
      }

      return db
    }

    /** Evict connections that haven't been accessed within cacheTtl */
    async function evictStale(): Promise<void> {
      const ttl = options.cacheTtl
      if (!ttl) return

      const now = Date.now()
      for (const [tenantId, lastTime] of lastAccessed) {
        if (now - lastTime > ttl) {
          const db = connections.get(tenantId)
          if (db && options.onTenantShutdown) {
            try {
              await options.onTenantShutdown(db, tenantId)
            } catch (err) {
              log.error(`Failed to evict tenant DB ${tenantId}: ${err}`)
            }
          }
          connections.delete(tenantId)
          lastAccessed.delete(tenantId)

          if (options.logging) {
            log.info(`Tenant DB evicted (idle): ${tenantId}`)
          }
        }
      }
    }

    return {
      // ── Extensions ──────────────────────────────────────────────
      getDb,
      get connectionCount() {
        return connections.size
      },

      // ── Lifecycle ───────────────────────────────────────────────

      async beforeStart({ container }) {
        // Reads the per-request tenant from the framework's request bag
        // (populated by an upstream contributor that augments
        // `ContextMeta` with `tenant: { id: string; … }`). See
        // https://forinda.github.io/kick-js/guide/multi-tenancy for the
        // full pattern. Outside an active request — singleton boot,
        // background jobs, tests without `requestScopeMiddleware()` —
        // `getRequestValue` returns `undefined` and the factory falls
        // back to the provider database.
        container.registerFactory(
          PRISMA_TENANT_CLIENT,
          () => {
            // Cast because the adopter's `ContextMeta` augmentation
            // owns the canonical `tenant` shape; this package only
            // needs `tenant.id` and intentionally doesn't widen the
            // augmentation surface.
            const tenant = getRequestValue('tenant') as { id?: string } | undefined
            return getDb(tenant?.id)
          },
          Scope.TRANSIENT,
        )

        log.info('Prisma tenant DB registered (resolves via getRequestValue("tenant"))')
      },

      async shutdown() {
        if (evictionTimer) clearInterval(evictionTimer)

        if (options.onTenantShutdown) {
          for (const [tenantId, db] of connections) {
            try {
              await options.onTenantShutdown(db, tenantId)
            } catch (err) {
              log.error(`Failed to close tenant DB ${tenantId}: ${err}`)
            }
          }
        }

        connections.clear()
        lastAccessed.clear()
        log.info('All tenant DB connections closed')
      },
    }
  },
})
