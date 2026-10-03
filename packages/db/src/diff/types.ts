import type {
  CheckSnapshot,
  ColumnSnapshot,
  EnumSnapshot,
  ForeignKeySnapshot,
  IndexSnapshot,
  PolicySnapshot,
  RoleSnapshot,
  TableSnapshot,
  ViewSnapshot,
} from '../snapshot/types'

/**
 * `CREATE SCHEMA IF NOT EXISTS "x"` — emitted ahead of every table change so
 * a new schema exists before anything is created inside it.
 *
 * There is deliberately no `dropSchema` counterpart. A schema can hold objects
 * this app never declared (another service's tables, extensions, views), so a
 * `DROP SCHEMA` inferred from "no table references it any more" could destroy
 * data the diff never saw. Removing a schema stays a manual operation.
 */
export interface CreateSchema {
  kind: 'createSchema'
  schema: string
}

export interface CreateTable {
  kind: 'createTable'
  table: TableSnapshot
}

export interface DropTable {
  kind: 'dropTable'
  table: TableSnapshot
}

export interface RenameTable {
  kind: 'renameTable'
  from: string
  to: string
}

export interface AddColumn {
  kind: 'addColumn'
  table: string
  column: ColumnSnapshot
}

export interface DropColumn {
  kind: 'dropColumn'
  table: string
  column: ColumnSnapshot
}

export interface RenameColumn {
  kind: 'renameColumn'
  table: string
  from: string
  to: string
}

export interface AlterColumn {
  kind: 'alterColumn'
  table: string
  column: string
  before: ColumnSnapshot
  after: ColumnSnapshot
}

export interface AddIndex {
  kind: 'addIndex'
  table: string
  index: IndexSnapshot
}

export interface DropIndex {
  kind: 'dropIndex'
  table: string
  index: IndexSnapshot
}

export interface AddForeignKey {
  kind: 'addForeignKey'
  table: string
  fk: ForeignKeySnapshot
}

export interface DropForeignKey {
  kind: 'dropForeignKey'
  table: string
  fk: ForeignKeySnapshot
}

export interface CreateEnum {
  kind: 'createEnum'
  enum: EnumSnapshot
}

export interface DropEnum {
  kind: 'dropEnum'
  enum: EnumSnapshot
}

/**
 * PG ALTER TYPE … ADD VALUE — non-destructive value addition.
 * Removed values can't round-trip without dropping dependent columns;
 * the diff engine surfaces them via the separate `RemoveEnumValue`
 * advisory below. Pure reorderings (same value set, different order)
 * currently produce no diff at all — PG honours the canonical sort
 * order at storage time, so user-visible behaviour is unchanged.
 */
export interface AddEnumValue {
  kind: 'addEnumValue'
  enum: string
  value: string
  /** When set, emit `ALTER TYPE … ADD VALUE 'x' BEFORE 'y'`. */
  before?: string
}

/**
 * Change raised when an enum keeps the same name but loses one or
 * more values across the diff. PostgreSQL has no `ALTER TYPE … DROP
 * VALUE`, so the emitter renders a rename-recreate dance behind a
 * `-- KICK ENUM REMOVE` header. The runner refuses to apply such a
 * migration without `confirmEnumDrop: true` on `RunnerOptions` (or
 * `--confirm-enum-drop` from the CLI).
 */
export interface RemoveEnumValue {
  kind: 'removeEnumValue'
  /** Enum type name. */
  enum: string
  /** Values present in the previous snapshot but not in the next. */
  removed: readonly string[]
  /**
   * Full value list AFTER the removal. Carried on the change so the
   * emitter can render `CREATE TYPE … AS ENUM (…)` without needing
   * the next-snapshot reference.
   */
  values: readonly string[]
  /**
   * Columns in the next snapshot whose declared type is this enum.
   * Each gets one `ALTER TABLE … ALTER COLUMN … TYPE foo USING
   * column::text::foo` clause inside the rename-recreate block.
   *
   * `default` carries the column's literal SQL default expression as
   * declared on the prior snapshot, or `null` when the column has no
   * default. The emitter wraps the type swap in
   * `DROP DEFAULT` / `SET DEFAULT … ::"<enum>"` brackets only when
   * this is non-null.
   */
  affectedColumns: readonly { table: string; column: string; default: string | null }[]
}

/** A table's primary key as a change sees it. Empty `columns` = no key. */
export interface PrimaryKeyShape {
  name?: string
  columns: string[]
}

/**
 * The primary key changed: different columns, column order, or (Postgres)
 * name. `before.columns` empty means one is added; `after.columns` empty,
 * that it's dropped. Emitters drop the old key, then add the new one.
 */
export interface AlterPrimaryKey {
  kind: 'alterPrimaryKey'
  table: string
  before: PrimaryKeyShape
  after: PrimaryKeyShape
}

export interface AddCheck {
  kind: 'addCheck'
  table: string
  check: CheckSnapshot
}

export interface DropCheck {
  kind: 'dropCheck'
  table: string
  check: CheckSnapshot
}

/**
 * Create a role if it doesn't exist (Postgres). Roles belong to the server,
 * so a removed one is never dropped and a down migration doesn't drop it.
 */
export interface CreateRole {
  kind: 'createRole'
  role: RoleSnapshot
}

/** Change a declared role's attributes (Postgres). Not inverted, like CreateRole. */
export interface AlterRole {
  kind: 'alterRole'
  role: RoleSnapshot
}

/** Turn row-level security on or off for a table, and whether it binds the owner. */
export interface SetRowLevelSecurity {
  kind: 'setRowLevelSecurity'
  table: string
  from: { force?: true } | null
  to: { force?: true } | null
}

export interface CreatePolicy {
  kind: 'createPolicy'
  table: string
  policy: PolicySnapshot
}

export interface DropPolicy {
  kind: 'dropPolicy'
  table: string
  policy: PolicySnapshot
}

/** Create a view (after every table change in the migration). */
export interface CreateView {
  kind: 'createView'
  view: ViewSnapshot
}

/** Drop a view (before every table change in the migration). */
export interface DropView {
  kind: 'dropView'
  view: ViewSnapshot
}

/** A table's comment changed; `null` is none. */
export interface SetTableComment {
  kind: 'setTableComment'
  table: string
  from: string | null
  to: string | null
}

/**
 * A column's comment changed; `null` is none. `column` is its definition,
 * for MySQL, which can only set a comment by restating it.
 */
export interface SetColumnComment {
  kind: 'setColumnComment'
  table: string
  column: ColumnSnapshot
  from: string | null
  to: string | null
}

export type Change =
  | CreateSchema
  | CreateTable
  | DropTable
  | RenameTable
  | AddColumn
  | DropColumn
  | RenameColumn
  | AlterColumn
  | AddIndex
  | DropIndex
  | AddForeignKey
  | DropForeignKey
  | CreateEnum
  | DropEnum
  | AddEnumValue
  | RemoveEnumValue
  | AlterPrimaryKey
  | AddCheck
  | DropCheck
  | SetTableComment
  | SetColumnComment
  | CreateView
  | DropView
  | CreateRole
  | AlterRole
  | SetRowLevelSecurity
  | CreatePolicy
  | DropPolicy

export type ChangeSet = Change[]
