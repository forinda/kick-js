export type Dialect = 'postgres' | 'sqlite' | 'mysql'

export type FkAction = 'cascade' | 'restrict' | 'set_null' | 'set_default' | 'no_action'

export interface ColumnSnapshot {
  name: string
  type: string
  nullable: boolean
  default: string | null
  primaryKey: boolean
}

export interface IndexSnapshot {
  name: string
  columns: string[]
  unique: boolean
}

export interface ForeignKeySnapshot {
  name: string
  columns: string[]
  refTable: string
  refColumns: string[]
  onDelete: FkAction
  onUpdate: FkAction
}

export interface CheckSnapshot {
  name: string
  expression: string
}

export interface TableSnapshot {
  name: string
  columns: Record<string, ColumnSnapshot>
  indexes: IndexSnapshot[]
  foreignKeys: ForeignKeySnapshot[]
  checks: CheckSnapshot[]
}

/**
 * PostgreSQL ENUM type declaration. Currently PG-only; the field is
 * optional on `SchemaSnapshot` so other dialects don't have to carry
 * a phantom `enums: {}`.
 */
export interface EnumSnapshot {
  name: string
  /** Allowed values, in declaration order. PG preserves the order. */
  values: readonly string[]
}

/**
 * Resolved relation graph attached as a sidecar on the snapshot.
 * Lives on `SchemaSnapshot.relations` (optional). Keyed
 * sourceTable → relationName → resolved entry. Consumed by the
 * relational-query compiler in `packages/db/src/query/`. The
 * migration pipeline does not read this field — relations are
 * query-time sugar, not DDL.
 *
 * Shaped this way (rather than re-using the runtime `RelationsDecl`)
 * so the snapshot stays JSON-serializable: no function thunks, no
 * back-references to table objects.
 */
export interface RelationSnapshot {
  kind: 'one' | 'many'
  /** Target table name. */
  target: string
  /** Columns on the source table that participate in the join. */
  sourceColumns: readonly string[]
  /** Columns on the target table that participate in the join. */
  targetColumns: readonly string[]
  /**
   * Optional pairing tag from `relationName: 'foo'` on both sides of
   * the relation. Disambiguates multi-FK schemas. See
   * docs/db/spec-relation-name.md (M4.B).
   */
  relationName?: string
}

export interface SchemaSnapshot {
  version: 1
  dialect: Dialect
  tables: Record<string, TableSnapshot>
  /** ENUM types declared via `pgEnum()`. PG-only; absent on other dialects. */
  enums?: Record<string, EnumSnapshot>
  /**
   * Optional relation sidecar populated when the schema includes
   * `relations()` declarations. Absent when no relations are
   * declared so M0/M1 callers see the same snapshot shape they
   * always did.
   */
  relations?: Record<string, Record<string, RelationSnapshot>>
}
