/** DI token for resolving the Drizzle database instance from the container */
export const DRIZZLE_DB = Symbol('DrizzleDB')

export interface DrizzleAdapterOptions {
  /**
   * Drizzle database instance — the return value of `drizzle()`.
   * Typed as `any` to avoid coupling to a specific driver (pg, mysql, sqlite).
   */
  db: any

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
