/**
 * Dispatch helper that selects the right relational-query compiler
 * for the runtime dialect detected by `createDbClient`. PG ships
 * `compilePg`; SQLite/MySQL throw at the first call so adopters get
 * a clear error instead of a silently broken `db.query`.
 *
 * Spec: docs/db/spec-relational-query.md §4.3.
 */

import { compilePg } from './compile-pg'
import { RelationalQueryNotSupportedError } from './errors'
import type { CompileFn } from './builder'

/**
 * Throw-stub used by the SQLite + MySQL dialects until M4 lands the
 * remaining compilers. Same signature as `compilePg` so the picker
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
  if (dialect === 'postgres') return compilePg as CompileFn
  return compileNotSupported(dialect)
}
