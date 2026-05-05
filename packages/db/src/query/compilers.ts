/**
 * Dispatch helper that selects the right relational-query compiler
 * for the runtime dialect detected by `createDbClient`. After M4.A.3
 * all three dialects ship real compilers — the throw-stub is
 * retired.
 *
 *   - PG     → `compilePg`     (kysely/helpers/postgres)
 *   - SQLite → `compileSqlite` (kysely/helpers/sqlite)
 *   - MySQL  → `compileMysql`  (kysely/helpers/mysql)
 *
 * Spec: docs/db/spec-relational-query.md §4.3 +
 * docs/db/spec-relational-query-other-dialects.md §4.
 */

import { compilePg } from './compile-pg'
import { compileSqlite } from './compile-sqlite'
import { compileMysql } from './compile-mysql'
import type { CompileFn } from './builder'

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
      return compileMysql as CompileFn
  }
}
