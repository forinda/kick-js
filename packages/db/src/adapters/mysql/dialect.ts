// mysqlDialect — thin factory over Kysely's MysqlDialect so adopters
// never have to reach for `import { MysqlDialect } from 'kysely'`.
// Mirrors the `@forinda/kickjs-db/pg` template; the kysely subpackage
// is a pinned internal dep of the framework.

import { MysqlDialect, type Dialect as KyselyDialect } from 'kysely'
import { KICK_DIALECT_DATES, markDialect, type DialectDateOptions } from '../../dialect-marker'

import type { MysqlPoolLike } from './adapter'

export interface MysqlDialectOptions {
  /**
   * mysql2-compatible pool — `createPool(...)` from `mysql2/promise`, the
   * same pool `mysqlAdapter` takes. A callback-API pool works too.
   */
  pool: MysqlPoolLike
}

/**
 * Construct the dialect that `createDbClient({ dialect })` consumes.
 *
 * **MySQL 8.0+ required.** Kickjs-db's relational query layer
 * compiles to `JSON_ARRAYAGG`, which shipped in 8.0. Adapter-side
 * version assertion lands at first connection from `mysqlAdapter()`;
 * see that factory's docs.
 *
 * @example
 * ```ts
 * import { createDbClient } from '@forinda/kickjs-db'
 * import { mysqlAdapter, mysqlDialect } from '@forinda/kickjs-db/mysql'
 * import { createPool } from 'mysql2/promise'
 *
 * const pool = createPool({
 *   host: '127.0.0.1', user: 'root', password: '...', database: 'app',
 * })
 *
 * export const db = createDbClient({
 *   schema,
 *   dialect: mysqlDialect({ pool }),
 * })
 *
 * export const migrationAdapter = mysqlAdapter({ pool })
 * ```
 */
export function mysqlDialect(opts: MysqlDialectOptions): KyselyDialect {
  // MysqlDialect's `pool` parameter is typed as `mysql2.Pool` in
  // newer Kysely versions; casting through `unknown` keeps adopters
  // using compatible drivers (e.g. mysql-mariadb forks) working
  // without pulling mysql2's typings into our public surface.
  // Kysely's MysqlDialect drives the callback API (`getConnection(cb)`). A
  // `mysql2/promise` pool ignores the callback, so every query hung; its
  // callback-API core is `pool.pool` — hand Kysely that.
  const raw = opts.pool as unknown as { pool?: { getConnection?: unknown } }
  const callbackPool = typeof raw.pool?.getConnection === 'function' ? raw.pool : opts.pool
  const dialect = markDialect(new MysqlDialect({ pool: callbackPool as unknown as never }), 'mysql')
  // Rows nested by `db.query` carry dates as strings; read them the way
  // mysql2 reads top-level ones — in the pool's time zone, and not at all
  // for the types `dateStrings` keeps as strings.
  type Cfg = { timezone?: string; dateStrings?: boolean | string[] }
  const config = (callbackPool as { config?: { connectionConfig?: Cfg } }).config?.connectionConfig
  const dates: DialectDateOptions = {
    timezone: config?.timezone ?? 'local',
    dateStrings: config?.dateStrings ?? false,
  }
  Object.defineProperty(dialect, KICK_DIALECT_DATES, { value: dates, enumerable: false })
  return dialect
}
