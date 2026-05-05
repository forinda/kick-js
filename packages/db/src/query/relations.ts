/**
 * Resolved-relation sidecar consumed by the query compiler. The
 * shape is canonical and lives on `SchemaSnapshot.relations`; we
 * re-export the same alias here so compile-time consumers can stay
 * scoped to `query/` imports without reaching into the snapshot
 * module.
 *
 * Spec: docs/db/spec-relational-query.md §5.3.
 */

import type { RelationSnapshot } from '../snapshot/types'

export type ResolvedRelation = RelationSnapshot

/**
 * Sidecar map: source table → relation name → resolved entry. Lives
 * on `SchemaSnapshot.relations` and is populated by
 * `extractRelations()` (`query/extract-relations.ts`).
 */
export type ResolvedRelations = Record<string, Record<string, ResolvedRelation>>
