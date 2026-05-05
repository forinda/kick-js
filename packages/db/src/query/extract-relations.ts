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
import {
  RelationalQueryAliasCollisionError,
  RelationalQueryAmbiguousRelationNameError,
  RelationalQueryMissingInverseError,
} from './errors'

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
          ...(rel.relationName ? { relationName: rel.relationName } : {}),
        }
        continue
      }

      // `many` resolution precedence (spec-relation-name.md §4):
      //   1. `relationName` match — both sides declared.
      //   2. Single untagged inverse `one` — exactly one + neither
      //      side has a relationName.
      //   3. FK introspection — exactly one FK back to source.
      //   4. Throw MissingInverseError with hint.
      const target = rel.target.__name
      const targetRelations = declsBySource[target] ?? {}

      // Step 1 — paired by relationName.
      if (rel.relationName) {
        const matchingInverses = findInversesByRelationName(
          targetRelations,
          sourceTable,
          rel.relationName,
        )
        if (matchingInverses.length > 1) {
          throw new RelationalQueryAmbiguousRelationNameError(
            sourceTable,
            rel.relationName,
            matchingInverses.map((m) => m.relationKey),
          )
        }
        if (matchingInverses.length === 1) {
          const inverse = matchingInverses[0]!.relation
          out[sourceTable][relationName] = {
            kind: 'many',
            target,
            sourceColumns: inverse.references.map((r) => r.__name),
            targetColumns: inverse.fields.map((f) => f.__name),
            relationName: rel.relationName,
          }
          continue
        }
        // Tagged on this side but no matching inverse — fall through
        // to FK fallback so the eventual error message lists what
        // the resolver looked at.
      }

      // Step 2 — single untagged inverse `one`.
      const untaggedInverse = findUniqueUntaggedInverse(targetRelations, sourceTable)
      if (untaggedInverse) {
        out[sourceTable][relationName] = {
          kind: 'many',
          target,
          sourceColumns: untaggedInverse.references.map((r) => r.__name),
          targetColumns: untaggedInverse.fields.map((f) => f.__name),
        }
        continue
      }

      // Step 3 — FK introspection fallback.
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

      // Step 4 — give up.
      throw new RelationalQueryMissingInverseError(sourceTable, relationName, target)
    }
  }

  return out
}

/**
 * Step-1 helper — find inverse `one` declarations on the target
 * table whose `relationName` matches the requested tag AND whose
 * own target is the source. Returns the relation key alongside the
 * relation itself so the ambiguous-error message can list the
 * conflicting names.
 */
function findInversesByRelationName(
  targetRelations: Record<string, Relation>,
  sourceTable: string,
  relationName: string,
): Array<{ relationKey: string; relation: RelationOne }> {
  const matches: Array<{ relationKey: string; relation: RelationOne }> = []
  for (const [key, rel] of Object.entries(targetRelations)) {
    if (
      rel.kind === 'one' &&
      rel.target.__name === sourceTable &&
      rel.relationName === relationName
    ) {
      matches.push({ relationKey: key, relation: rel })
    }
  }
  return matches
}

/**
 * Step-2 helper — find a single inverse `one` on the target table
 * pointing at the source AND with **no** `relationName` set. The
 * uniqueness check is the M4.B tightening of M3's first-match
 * heuristic; multi-FK schemas now surface as `MissingInverseError`
 * (which routes adopters at adding `relationName`) instead of
 * silently picking the first inverse.
 */
function findUniqueUntaggedInverse(
  targetRelations: Record<string, Relation>,
  sourceTable: string,
): RelationOne | null {
  let unique: RelationOne | null = null
  for (const rel of Object.values(targetRelations)) {
    if (rel.kind === 'one' && rel.target.__name === sourceTable && rel.relationName === undefined) {
      if (unique) return null // ambiguous — caller falls through
      unique = rel
    }
  }
  return unique
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
