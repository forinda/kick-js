// sqliteDialect — thin factory over Kysely's SqliteDialect so adopters
// never have to reach for `import { SqliteDialect } from 'kysely'`.
// Mirrors the `@forinda/kickjs-db/pg` template; the kysely subpackage
// is a pinned internal dep of the framework.

import { SqliteDialect, type Dialect as KyselyDialect } from 'kysely'

import { markDialect } from '../../dialect-marker'
import type { SqliteDatabaseLike } from './adapter'

export interface SqliteDialectOptions {
  /**
   * better-sqlite3-compatible database handle. Both `new Database(...)`
   * from `better-sqlite3` and bun's `bun:sqlite` `Database` match
   * structurally (Bun is best-effort — same `.prepare()` shape, no
   * version assertion).
   */
  database: SqliteDatabaseLike
}

/**
 * Construct the dialect that `createDbClient({ dialect })` consumes.
 *
 * @example
 * ```ts
 * import { createDbClient } from '@forinda/kickjs-db'
 * import { sqliteDialect, sqliteAdapter } from '@forinda/kickjs-db/sqlite'
 * import Database from 'better-sqlite3'
 *
 * const database = new Database(':memory:')
 *
 * export const db = createDbClient({
 *   schema,
 *   dialect: sqliteDialect({ database }),
 * })
 *
 * export const migrationAdapter = sqliteAdapter({ database })
 * ```
 */
export function sqliteDialect(opts: SqliteDialectOptions): KyselyDialect {
  return markDialect(new SqliteDialect({ database: opts.database as never }), 'sqlite')
}
