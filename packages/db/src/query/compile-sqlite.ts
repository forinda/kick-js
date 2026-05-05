/**
 * SQLite compiler for `db.query.X.findMany({ with })`.
 *
 * Strategy locked in `docs/db/spec-relational-query-other-dialects.md`
 * §3.1: each `many` relation becomes a Kysely `jsonArrayFrom(...)`
 * select expression that compiles to
 * `coalesce(json_group_array(json_object(...)), '[]')`. Each `one`
 * becomes `jsonObjectFrom(...)`, compiling to a `json_object(...)`
 * call with `LIMIT 1`. The traversal logic is shared with the PG +
 * MySQL compilers via `runCompile`.
 *
 * Result-decoding: SQLite drivers return JSON columns as TEXT;
 * `createDbClient` auto-attaches `ParseJSONResultsPlugin` for the
 * SQLite dialect so the nested JSON round-trips back to JS objects
 * before the codec / row-handler chain runs.
 */

import { type Kysely, type CompiledQuery } from 'kysely'
import { jsonArrayFrom, jsonObjectFrom } from 'kysely/helpers/sqlite'
import {
  runCompile,
  type CompileMode,
  type CompileOptions,
  type JsonHelpers,
} from './compile-shared'
import type { ResolvedRelations } from './relations'
import type { TableSnapshot } from '../snapshot/types'

const SQLITE_HELPERS: JsonHelpers = {
  jsonArrayFrom: jsonArrayFrom as unknown as JsonHelpers['jsonArrayFrom'],
  jsonObjectFrom: jsonObjectFrom as unknown as JsonHelpers['jsonObjectFrom'],
}

export function compileSqlite<DB>(
  db: Kysely<DB>,
  table: string,
  options: CompileOptions,
  relations: ResolvedRelations,
  tables: Record<string, TableSnapshot>,
  mode: CompileMode = 'many',
): CompiledQuery {
  return runCompile(db, table, options, relations, tables, mode, SQLITE_HELPERS)
}
