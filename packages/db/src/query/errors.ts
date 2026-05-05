/**
 * Errors thrown by the relational-query compiler. All extend
 * `KickDbError` so adopters can catch the family with a single
 * `instanceof` check.
 *
 * Spec: docs/db/spec-relational-query.md §6 (edge cases) + §7 (R-3,
 * R-5).
 */

import { KickDbError } from '../errors'

/**
 * Thrown at compile time when a `with` key references a relation
 * that the source table doesn't declare.
 */
export class RelationalQueryUnknownRelationError extends KickDbError {
  readonly sourceTable: string
  readonly relationKey: string
  constructor(sourceTable: string, relationKey: string) {
    super(
      'KICK_DB_RELATIONAL_UNKNOWN_RELATION',
      `Unknown relation \`${sourceTable}.${relationKey}\` — declare it via \`relations()\` ` +
        `before referencing it inside \`db.query.${sourceTable}.findMany({ with })\`.`,
    )
    this.sourceTable = sourceTable
    this.relationKey = relationKey
  }
}

/**
 * Thrown at compile time when a `with` clause nests deeper than
 * `maxDepth` (spec §7 R-3, default 5). Catches infinite specs on
 * self-referencing tables before any SQL is built.
 */
export class RelationalQueryDepthError extends KickDbError {
  readonly maxDepth: number
  readonly trace: readonly string[]
  constructor(maxDepth: number, trace: readonly string[]) {
    super(
      'KICK_DB_RELATIONAL_DEPTH_EXCEEDED',
      `Relational query exceeds maxDepth=${maxDepth}. Path: ${trace.join(' → ')}. ` +
        `Override with \`{ maxDepth: N }\` on the call site if intentional.`,
    )
    this.maxDepth = maxDepth
    this.trace = trace
  }
}

/**
 * Thrown at compile time when a relation name collides with a
 * literal column on the same table (spec §7 R-5). Forces the schema
 * author to rename one of them so the LATERAL alias stays
 * unambiguous.
 */
export class RelationalQueryAliasCollisionError extends KickDbError {
  readonly sourceTable: string
  readonly conflictingName: string
  constructor(sourceTable: string, conflictingName: string) {
    super(
      'KICK_DB_RELATIONAL_ALIAS_COLLISION',
      `Relation \`${sourceTable}.${conflictingName}\` collides with a column of the same name. ` +
        `Rename the relation or the column to disambiguate.`,
    )
    this.sourceTable = sourceTable
    this.conflictingName = conflictingName
  }
}

/**
 * Thrown by SQLite + MySQL compiler stubs in v1. The interface ships
 * with PG only; the other dialects fill in during M4 without an API
 * change at the call site.
 */
export class RelationalQueryNotSupportedError extends KickDbError {
  readonly dialect: string
  constructor(dialect: string) {
    super(
      'KICK_DB_RELATIONAL_NOT_SUPPORTED',
      `Relational query compiler for dialect \`${dialect}\` lands in M4. ` +
        `Use layer 1 / 2 (\`db.selectFrom(...)\`) with manual joins for now.`,
    )
    this.dialect = dialect
  }
}
