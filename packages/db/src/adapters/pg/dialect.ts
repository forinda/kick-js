// pgDialect — thin factory over Kysely's PostgresDialect so adopters
// never have to write `import { PostgresDialect } from 'kysely'`.
// Kysely is a pinned internal dep of the framework; surfacing it
// through our own export keeps the adopter import surface stable
// even when we change query backends (or fork Kysely's internals).

import { PostgresDialect, type Dialect as KyselyDialect } from 'kysely'
import { markDialect } from '../../dialect-marker'

import type { PgPoolLike } from './adapter'

export interface PgDialectOptions {
  /**
   * pg-protocol-compatible pool. Both `pg.Pool` and
   * `@neondatabase/serverless`'s Pool match structurally; adopters
   * pick whichever runtime fits.
   */
  pool: PgPoolLike
}

/**
 * Construct the dialect that `createDbClient({ dialect })` consumes.
 *
 * @example
 * ```ts
 * import { createDbClient } from '@forinda/kickjs-db'
 * import { pgDialect, pgAdapter } from '@forinda/kickjs-db/pg'
 * import { Pool } from 'pg'
 *
 * const pool = new Pool({ connectionString: process.env.DATABASE_URL })
 *
 * export const db = createDbClient({
 *   schema,
 *   dialect: pgDialect({ pool }),
 * })
 *
 * export const migrationAdapter = pgAdapter({ pool })
 * ```
 */
export function pgDialect(opts: PgDialectOptions): KyselyDialect {
  // PostgresDialect's `pool` parameter is typed as `PG.Pool` in newer
  // Kysely versions; casting through `unknown` keeps adopters using
  // alternate clients (neon, pg-cloudflare) compatible without
  // pulling node-postgres' typings into our public surface.
  return markDialect(new PostgresDialect({ pool: opts.pool as unknown as never }), 'postgres')
}
