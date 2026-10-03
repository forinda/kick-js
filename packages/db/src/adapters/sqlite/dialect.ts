// sqliteDialect — thin factory over Kysely's SqliteDialect so adopters
// never have to reach for `import { SqliteDialect } from 'kysely'`.
// Mirrors the `@forinda/kickjs-db/pg` template; the kysely subpackage
// is a pinned internal dep of the framework.

import { SqliteDialect, type Dialect as KyselyDialect } from 'kysely'

import { markDialect } from '../../dialect-marker'
import type { SqliteDatabaseLike } from './adapter'

export interface SqliteDialectOptions {
  /**
   * A better-sqlite3 `Database`, or a `bun:sqlite` `Database` (tested in
   * CI's Bun job).
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
  return markDialect(new SqliteDialect({ database: readerDatabase(opts.database) }), 'sqlite')
}

/** What Kysely's SQLite driver calls on a prepared statement. */
type KyselyStatement = {
  reader: boolean
  all(params: readonly unknown[]): unknown[]
  run(params: readonly unknown[]): { changes: number | bigint; lastInsertRowid: number | bigint }
  iterate(params: readonly unknown[]): IterableIterator<unknown>
}

type LooseStatement = {
  reader?: unknown
  columnNames?: readonly string[]
  all(...params: unknown[]): unknown[]
  run(...params: unknown[]): { changes: number | bigint; lastInsertRowid: number | bigint }
  iterate?(...params: unknown[]): IterableIterator<unknown>
}

/**
 * Kysely's SQLite driver asks a statement whether it returns rows
 * (`stmt.reader`, a better-sqlite3 field) and passes the parameters as one
 * array. `bun:sqlite` has neither: without this, every SELECT ran as a write
 * and returned no rows. A better-sqlite3 statement passes through as is.
 */
function readerDatabase(database: SqliteDatabaseLike): never {
  return {
    close: () => database.close(),
    prepare(sql: string): KyselyStatement {
      const stmt = database.prepare(sql) as unknown as LooseStatement
      if (typeof stmt.reader === 'boolean') return stmt as unknown as KyselyStatement
      return {
        reader: (stmt.columnNames?.length ?? 0) > 0,
        all: (params) => stmt.all(...params),
        run: (params) => stmt.run(...params),
        iterate: (params) =>
          stmt.iterate ? stmt.iterate(...params) : stmt.all(...params)[Symbol.iterator](),
      }
    },
  } as never
}
