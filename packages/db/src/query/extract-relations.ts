/**
 * Resolve `relations()` declarations into the JSON-serializable
 * sidecar shape consumed by the relational-query compiler.
 *
 *  - `one` relations resolve straight from `RelationOne.{fields,
 *    references}`.
 *  - `many` relations resolve via the inverse `one` on the target
 *    table — drizzle-style symmetric declarations. If no inverse
 *    exists, throw `RelationalQueryMissingInverseError` at extract
 *    time so adopters get a clear error before the schema ships.
 *  - Alias collisions (a relation name that shadows a column on the
 *    same table) throw `RelationalQueryAliasCollisionError` per spec
 *    §7 R-5.
 *
 * Spec: docs/db/spec-relational-query.md §5.3.
 */

import type { Relation, RelationOne, RelationsDecl } from '../dsl/relations'
import type { TableSnapshot } from '../snapshot/types'
import type { ResolvedRelations } from './relations'
import { RelationalQueryAliasCollisionError, RelationalQueryMissingInverseError } from './errors'

interface MaybeRelations {
  __isRelations?: boolean
  __sourceTable?: string
  __relations?: Record<string, Relation>
}

function isRelations(v: unknown): v is RelationsDecl {
  return Boolean(v && typeof v === 'object' && (v as MaybeRelations).__isRelations === true)
}

/**
 * Walk the schema record for `RelationsDecl` entries and return the
 * resolved sidecar. Returns `undefined` when no relations are
 * declared so callers can leave the snapshot's `relations` field
 * absent.
 */
export function extractRelations(
  schema: Record<string, unknown>,
  tables: Record<string, TableSnapshot>,
): ResolvedRelations | undefined {
  const declsBySource: Record<string, Record<string, Relation>> = {}

  for (const value of Object.values(schema)) {
    if (isRelations(value)) {
      // A second `relations()` call against the same source merges —
      // adopters can split one large declaration across files. Last
      // writer wins on duplicate keys.
      declsBySource[value.__sourceTable] = {
        ...declsBySource[value.__sourceTable],
        ...value.__relations,
      }
    }
  }

  if (Object.keys(declsBySource).length === 0) return undefined

  const out: ResolvedRelations = {}

  for (const [sourceTable, relations] of Object.entries(declsBySource)) {
    const tableSnapshot = tables[sourceTable]
    // Ignore relations declared against an unknown table — `extract`
    // already skips non-table entries; mismatched relations() calls
    // get the same treatment rather than throwing on a typo.
    if (!tableSnapshot) continue

    out[sourceTable] = {}

    for (const [relationName, rel] of Object.entries(relations)) {
      if (relationName in tableSnapshot.columns) {
        throw new RelationalQueryAliasCollisionError(sourceTable, relationName)
      }

      if (rel.kind === 'one') {
        out[sourceTable][relationName] = {
          kind: 'one',
          target: rel.target.__name,
          sourceColumns: rel.fields.map((f) => f.__name),
          targetColumns: rel.references.map((r) => r.__name),
        }
        continue
      }

      // `many` — resolve via the inverse `one` on the target table
      // when declared. Otherwise fall back to FK introspection: walk
      // the target table's foreign keys for a single FK back to the
      // source. This keeps M0/M1 schemas (declared with `many` only,
      // no inverse) working without a forced rewrite.
      const target = rel.target.__name
      const inverse = findInverseOne(declsBySource[target] ?? {}, sourceTable)
      if (inverse) {
        out[sourceTable][relationName] = {
          kind: 'many',
          target,
          sourceColumns: inverse.references.map((r) => r.__name),
          targetColumns: inverse.fields.map((f) => f.__name),
        }
        continue
      }

      const fkFallback = resolveByForeignKey(tables[target], sourceTable)
      if (fkFallback) {
        out[sourceTable][relationName] = {
          kind: 'many',
          target,
          sourceColumns: fkFallback.refColumns,
          targetColumns: fkFallback.columns,
        }
        continue
      }

      throw new RelationalQueryMissingInverseError(sourceTable, relationName, target)
    }
  }

  return out
}

function findInverseOne(
  targetRelations: Record<string, Relation>,
  sourceTable: string,
): RelationOne | null {
  for (const rel of Object.values(targetRelations)) {
    if (rel.kind === 'one' && rel.target.__name === sourceTable) {
      return rel
    }
  }
  return null
}

/**
 * Fallback resolution path for `many` relations without an inverse
 * `one`. Walks the target table's FK list for a single edge back to
 * the source. Returns `null` when there is no FK or when more than
 * one FK qualifies — adopters with ambiguous schemas need the
 * explicit inverse to disambiguate.
 */
function resolveByForeignKey(
  targetTable: TableSnapshot | undefined,
  sourceTable: string,
): { columns: readonly string[]; refColumns: readonly string[] } | null {
  if (!targetTable) return null
  const matches = targetTable.foreignKeys.filter((fk) => fk.refTable === sourceTable)
  if (matches.length !== 1) return null
  const fk = matches[0]!
  return { columns: fk.columns, refColumns: fk.refColumns }
}
