/**
 * MySQL compiler for `db.query.X.findMany({ with })`.
 *
 * Strategy locked in `docs/db/spec-relational-query-other-dialects.md`
 * §3.2: each `many` relation becomes a Kysely `jsonArrayFrom(...)`
 * select expression that compiles to
 * `cast(coalesce(json_arrayagg(json_object(...)), '[]') as json)`.
 * Each `one` becomes `jsonObjectFrom(...)`, compiling to a
 * `JSON_OBJECT(...)` call with `LIMIT 1`. The traversal logic is
 * shared with the PG + SQLite compilers via `runCompile`.
 *
 * Result-decoding: MySQL drivers return JSON columns as TEXT (or
 * Buffers for older mysql2 configs); `createDbClient` auto-attaches
 * `ParseJSONResultsPlugin` for the MySQL dialect so the nested JSON
 * round-trips back to JS objects before the codec / row-handler
 * chain runs.
 *
 * MySQL minimum version: **8.0+**. `JSON_ARRAYAGG` shipped in 8.0;
 * earlier versions don't have it. The version check fires at the
 * adapter layer (`mysqlAdapter()` — M4.A.5) on first connection so
 * adopters get a clear error before any query reaches this
 * compiler. Spec R-1.
 */

import { type Kysely, type CompiledQuery } from 'kysely'
import { jsonArrayFrom, jsonObjectFrom } from 'kysely/helpers/mysql'
import {
  runCompile,
  type CompileMode,
  type CompileOptions,
  type JsonHelpers,
} from './compile-shared'
import type { ResolvedRelations } from './relations'
import type { TableSnapshot } from '../snapshot/types'

const MYSQL_HELPERS: JsonHelpers = {
  jsonArrayFrom: jsonArrayFrom as unknown as JsonHelpers['jsonArrayFrom'],
  jsonObjectFrom: jsonObjectFrom as unknown as JsonHelpers['jsonObjectFrom'],
}

export function compileMysql<DB>(
  db: Kysely<DB>,
  table: string,
  options: CompileOptions,
  relations: ResolvedRelations,
  tables: Record<string, TableSnapshot>,
  mode: CompileMode = 'many',
): CompiledQuery {
  return runCompile(db, table, options, relations, tables, mode, MYSQL_HELPERS)
}
