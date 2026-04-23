import { createToken, type MaybePromise } from '@forinda/kickjs'

/**
 * DI token for resolving the Drizzle database instance from the container (single-tenant).
 *
 * Typed as `unknown` because Drizzle's database type depends on the user's
 * driver + schema; cast at the use site
 * (e.g. `@Inject(DRIZZLE_DB) private db!: BetterSQLite3Database<typeof schema>`).
 */
export const DRIZZLE_DB = createToken<unknown>('kick/drizzle/DB')

/**
 * DI token for resolving the current tenant's Drizzle database instance (multi-tenant).
 *
 * Same typing caveat as {@link DRIZZLE_DB} — cast at the use site.
 */
export const DRIZZLE_TENANT_DB = createToken<unknown>('kick/drizzle/DB:tenant')

export interface DrizzleAdapterOptions<TDb = unknown> {
  /**
   * Drizzle database instance — the return value of `drizzle()`.
   * Preserves the full type so services can inject it type-safely.
   *
   * @example
   * ```ts
   * import { drizzle } from 'drizzle-orm/better-sqlite3'
   * import * as schema from './schema'
   *
   * const db = drizzle({ client: sqlite, schema })
   * // db is BetterSQLite3Database<typeof schema>
   *
   * DrizzleAdapter({ db })
   * // TDb is inferred as BetterSQLite3Database<typeof schema>
   * ```
   */
  db: TDb

  /** Enable query logging (default: false) */
  logging?: boolean

  /**
   * Optional shutdown function to close the underlying connection pool.
   * Drizzle doesn't expose a universal disconnect — this lets you pass your
   * driver's cleanup (e.g., `pool.end()` for postgres, `client.close()` for libsql).
   *
   * @example
   * ```ts
   * const pool = new Pool({ connectionString: '...' })
   * const db = drizzle(pool)
   *
   * DrizzleAdapter({
   *   db,
   *   onShutdown: () => pool.end(),
   * })
   * ```
   */
  onShutdown?: () => MaybePromise<any>
}

export interface DrizzleTenantAdapterOptions<TDb = unknown> {
  /**
   * The provider (default) database instance. Used when no tenant is
   * resolved or when accessing the tenant registry.
   */
  providerDb: TDb

  /**
   * Factory that creates a typed Drizzle instance for a given tenant.
   * Called once per tenant — the result is cached for subsequent requests.
   *
   * @example
   * ```ts
   * tenantFactory: async (tenantId) => {
   *   const url = await lookupTenantDbUrl(tenantId)
   *   return drizzle(new Pool({ connectionString: url }), { schema })
   * }
   * ```
   */
  tenantFactory: (tenantId: string) => TDb | Promise<TDb>

  /**
   * Optional function to close a tenant DB connection.
   * Called for each cached connection during shutdown.
   */
  onTenantShutdown?: (db: TDb, tenantId: string) => MaybePromise<any>

  /** Enable query logging (default: false) */
  logging?: boolean

  /**
   * Cache TTL in milliseconds. Tenant connections idle beyond this
   * duration are evicted. Default: no eviction (connections live until shutdown).
   */
  cacheTtl?: number
}
