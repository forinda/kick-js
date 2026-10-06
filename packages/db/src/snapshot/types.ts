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
  /** The column's comment in the database (Postgres, MySQL). */
  comment?: string
  /**
   * Only on an introspected snapshot read back into keys: the database's own
   * name, when `casing` wouldn't give it back — rendered as `.dbName()`.
   */
  dbName?: string
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
  /** The table's comment in the database (Postgres, MySQL). */
  comment?: string
  /** Row-level security is on (Postgres); `force` applies it to the table's owner too. */
  rls?: { force?: true }
  /** Row-level security policies (Postgres). */
  policies?: PolicySnapshot[]
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

/** A row-level security policy (Postgres). */
export interface PolicySnapshot {
  name: string
  as: 'permissive' | 'restrictive'
  command: 'all' | 'select' | 'insert' | 'update' | 'delete'
  /** Role names; `public` is everyone. */
  to: string[]
  using?: string
  withCheck?: string
}

/** A Postgres role the schema declares (created if missing, never dropped). */
export interface RoleSnapshot {
  name: string
  login?: boolean
  createDb?: boolean
  createRole?: boolean
  /** Default true: privileges of roles it's a member of apply to it. */
  inherit?: boolean
  bypassRls?: boolean
}

export interface ViewSnapshot {
  name: string
  /** The `SELECT`, as declared (or as the database reports it, when introspected). */
  definition: string
  /** A materialized view (Postgres). */
  materialized?: true
  /** Indexes on a materialized view. */
  indexes?: IndexSnapshot[]
  /**
   * The columns, when introspected — for `kick db introspect` to render.
   * Not compared: the definition decides what a view returns.
   */
  columns?: Record<string, ColumnSnapshot>
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
   * Views, in declaration order — the order they're created in, so a view can
   * select from one declared before it. Absent when there are none.
   */
  views?: Record<string, ViewSnapshot>
  /** Roles declared with `pgRole()` (Postgres). Absent when none. */
  roles?: Record<string, RoleSnapshot>
  /**
   * Optional relation sidecar populated when the schema includes
   * `relations()` declarations. Absent when no relations are
   * declared so M0/M1 callers see the same snapshot shape they
   * always did.
   */
  relations?: Record<string, Record<string, RelationSnapshot>>
}
