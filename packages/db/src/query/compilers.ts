/**
 * Dispatch helper that selects the right relational-query compiler
 * for the runtime dialect detected by `createDbClient`.
 *
 *   - PG     → `compilePg`     (kysely/helpers/postgres)
 *   - SQLite → `compileSqlite` (kysely/helpers/sqlite, M4.A.2)
 *   - MySQL  → throw-stub      (compileMysql lands in M4.A.3)
 *
 * Spec: docs/db/spec-relational-query.md §4.3 +
 * docs/db/spec-relational-query-other-dialects.md §4.
 */

import { compilePg } from './compile-pg'
import { compileSqlite } from './compile-sqlite'
import { RelationalQueryNotSupportedError } from './errors'
import type { CompileFn } from './builder'

/**
 * Throw-stub still used by the MySQL dialect until M4.A.3 fills it
 * in. Same signature as `compilePg` / `compileSqlite` so the picker
 * is a one-line lookup.
 */
const compileNotSupported =
  (dialect: string): CompileFn =>
  () => {
    throw new RelationalQueryNotSupportedError(dialect)
  }

/**
 * Pick a compiler by dialect tag. Used by `createDbClient` after it
 * detects the dialect from the Kysely instance's class name.
 */
export function pickCompiler(dialect: 'postgres' | 'sqlite' | 'mysql'): CompileFn {
  switch (dialect) {
    case 'postgres':
      return compilePg as CompileFn
    case 'sqlite':
      return compileSqlite as CompileFn
    case 'mysql':
      return compileNotSupported('mysql')
  }
}
