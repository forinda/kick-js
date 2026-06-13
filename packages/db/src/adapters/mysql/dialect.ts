// mysqlDialect — thin factory over Kysely's MysqlDialect so adopters
// never have to reach for `import { MysqlDialect } from 'kysely'`.
// Mirrors the `@forinda/kickjs-db/pg` template; the kysely subpackage
// is a pinned internal dep of the framework.

import { MysqlDialect, type Dialect as KyselyDialect } from 'kysely'
import { markDialect } from '../../dialect-marker'

import type { MysqlPoolLike } from './adapter'

export interface MysqlDialectOptions {
  /**
   * mysql2-compatible pool. Both `mysql.createPool(...)` from
   * `mysql2/promise` and `mysql2.createPool(...)` (callback API
   * wrapped in a promise) match structurally.
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
  return markDialect(new MysqlDialect({ pool: opts.pool as unknown as never }), 'mysql')
}
