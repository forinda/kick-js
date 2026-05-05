/**
 * PostgreSQL compiler for `db.query.X.findMany({ with })`.
 *
 * Strategy locked in `docs/db/spec-relational-query.md` §4.1:
 *
 *  - Each `many` relation becomes a Kysely `jsonArrayFrom(...)`
 *    select expression (PG: `coalesce((select json_agg(agg) from
 *    (...) as agg), '[]')`). Empty inner result aggregates to `[]`,
 *    not `null`.
 *  - Each `one` relation becomes `jsonObjectFrom(...)` (PG:
 *    `(select to_json(obj) from (...) as obj)`). Empty inner result
 *    is `null`.
 *
 * After M4.A.2, the traversal logic lives in `compile-shared.ts`
 * and is shared with the SQLite + MySQL compilers. This file is a
 * thin wrapper that hands `kysely/helpers/postgres`'s helpers to
 * the shared runner.
 */

import { type Kysely, type CompiledQuery } from 'kysely'
import { jsonArrayFrom, jsonObjectFrom } from 'kysely/helpers/postgres'
import {
  runCompile,
  type CompileMode,
  type CompileOptions,
  type JsonHelpers,
} from './compile-shared'
import type { ResolvedRelations } from './relations'
import type { TableSnapshot } from '../snapshot/types'

export type { CompileMode, CompileOptions as CompilePgOptions }

const PG_HELPERS: JsonHelpers = {
  jsonArrayFrom: jsonArrayFrom as unknown as JsonHelpers['jsonArrayFrom'],
  jsonObjectFrom: jsonObjectFrom as unknown as JsonHelpers['jsonObjectFrom'],
}

export function compilePg<DB>(
  db: Kysely<DB>,
  table: string,
  options: CompileOptions,
  relations: ResolvedRelations,
  tables: Record<string, TableSnapshot>,
  mode: CompileMode = 'many',
): CompiledQuery {
  return runCompile(db, table, options, relations, tables, mode, PG_HELPERS)
}
