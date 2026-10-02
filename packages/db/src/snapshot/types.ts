export type Dialect = 'postgres' | 'sqlite' | 'mysql'

export type FkAction = 'cascade' | 'restrict' | 'set_null' | 'set_default' | 'no_action'

export interface ColumnSnapshot {
  name: string
  type: string
  nullable: boolean
  default: string | null
  primaryKey: boolean
  /** A column the database computes from others: `GENERATED ALWAYS AS (expression)`. */
  generated?: { expression: string; stored: boolean }
  /** An identity column (Postgres): `GENERATED ALWAYS | BY DEFAULT AS IDENTITY`. */
  identity?: 'always' | 'byDefault'
}

export interface IndexSnapshot {
  name: string
  /** Key parts in order: a column name, or an SQL expression wrapped in parentheses. */
  columns: string[]
  unique: boolean
  /** Partial index predicate (Postgres, SQLite), as SQL. */
  where?: string
  /** Index method, e.g. `gin`, `gist`, `hnsw` (Postgres) or `hash` (MySQL). Absent means the default. */
  using?: string
  /** Non-key columns stored in the index (Postgres `INCLUDE`). */
  include?: string[]
  /** Operator class per key part, keyed by the entry in `columns` (Postgres). */
  opclasses?: Record<string, string>
  /** Build and drop without locking writes (Postgres). Doesn't change the index itself. */
  concurrently?: boolean
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
  /**
   * Bare table name, unqualified. The schema (when any) lives in
   * {@link TableSnapshot.schema}; the map key on `SchemaSnapshot.tables` is
   * the qualified form (`billing.invoices`).
   */
  name: string
  /**
   * Named SQL schema, from `pgSchema('x').table(...)`. Absent for tables in
   * the connection's default search_path, which keeps pre-schema snapshots
   * byte-identical (and their migration hashes valid).
   */
  schema?: string
  columns: Record<string, ColumnSnapshot>
  indexes: IndexSnapshot[]
  foreignKeys: ForeignKeySnapshot[]
  checks: CheckSnapshot[]
  /**
   * The key declared with `primaryKey(name?).on(...)`: its name and column
   * order. The columns also carry `primaryKey: true`. Absent for a key
   * declared on columns, so those snapshots — and migration hashes — stay
   * as they were.
   */
  primaryKey?: { name?: string; columns: string[] }
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
   * the relation. Disambiguates multi-FK schemas.
   */
  relationName?: string
  /**
   * For a many-to-many: the junction table, and its columns that hold the
   * source's `sourceColumns` and the target's `targetColumns`.
   */
  through?: { table: string; sourceColumns: readonly string[]; targetColumns: readonly string[] }
}

export interface SchemaSnapshot {
  version: 1
  dialect: Dialect
  /**
   * Keyed by QUALIFIED name — `billing.invoices` for a table declared through
   * `pgSchema('billing')`, the bare name otherwise. Qualifying the key is what
   * lets two schemas hold same-named tables without colliding, and it makes
   * every `table: string` field on a diff `Change` already schema-correct:
   * `quoteIdent` splits on `.`, rendering `"billing"."invoices"`.
   */
  tables: Record<string, TableSnapshot>
  /**
   * Named schemas the tables in this snapshot live in, sorted. Drives
   * `CREATE SCHEMA IF NOT EXISTS` emission. PG-only; absent when no table
   * declares a schema, so existing snapshots keep their exact shape.
   */
  schemas?: readonly string[]
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
