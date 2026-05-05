/**
 * Resolved-relation sidecar consumed by the query compiler. Every
 * relation declared via `relations()` resolves to one of these
 * entries — `kind` + target table + the column pair linking source
 * and target.
 *
 * For `one` relations the columns come straight from the
 * `RelationOne.{fields, references}` declaration. For `many`
 * relations there are no columns on the source side; the resolver
 * (in `relations-resolve.ts`, M3.A.4) walks back through the target
 * table's `one` relations to find the inverse, then flips
 * source/target.
 *
 * The compiler reads from this sidecar and stays oblivious to the
 * `relations()` DSL. Tests can construct `ResolvedRelations` literals
 * directly without going through `extractSnapshot`.
 *
 * Spec: docs/db/spec-relational-query.md §5.3.
 */

export interface ResolvedRelation {
  kind: 'one' | 'many'
  /** Target table name. */
  target: string
  /** Columns on the source table that participate in the join. */
  sourceColumns: readonly string[]
  /** Columns on the target table that participate in the join. */
  targetColumns: readonly string[]
}

/**
 * Sidecar map: source table → relation name → resolved entry. Lives
 * on `SchemaSnapshot.relations` (extension landing in M3.A.4).
 */
export type ResolvedRelations = Record<string, Record<string, ResolvedRelation>>
