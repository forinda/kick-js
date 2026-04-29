import type {
  ColumnSnapshot,
  EnumSnapshot,
  ForeignKeySnapshot,
  IndexSnapshot,
  TableSnapshot,
} from '../snapshot/types'

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
 * Removed values + reorderings can't round-trip without dropping
 * dependent columns; the diff engine surfaces them as a separate
 * `RemoveEnumValue` advisory below.
 */
export interface AddEnumValue {
  kind: 'addEnumValue'
  enum: string
  value: string
  /** When set, emit `ALTER TYPE … ADD VALUE 'x' BEFORE 'y'`. */
  before?: string
}

/**
 * Advisory-only change kind raised when an enum keeps the same name
 * but loses one or more values across the diff. PostgreSQL has no
 * `ALTER TYPE … DROP VALUE` — round-tripping requires dropping every
 * column that uses the type, dropping the type, recreating with the
 * new value list, then recreating the columns and restoring data.
 *
 * The diff engine records the removed values; the emitter renders a
 * multi-line SQL comment with explicit guidance instead of a no-op
 * silently swallowed by the migration runner. Operators choosing to
 * proceed write the multi-step migration by hand.
 */
export interface RemoveEnumValue {
  kind: 'removeEnumValue'
  /** Enum type name. */
  enum: string
  /** Values present in the previous snapshot but not in the next. */
  removed: readonly string[]
}

export type Change =
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

export type ChangeSet = Change[]
