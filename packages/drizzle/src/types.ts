/** DI token for resolving the Drizzle database instance from the container */
export const DRIZZLE_DB = Symbol('DrizzleDB')

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
   * new DrizzleAdapter({ db })
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
   * new DrizzleAdapter({
   *   db,
   *   onShutdown: () => pool.end(),
   * })
   * ```
   */
  onShutdown?: () => void | Promise<void>
}
