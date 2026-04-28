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

export interface SchemaSnapshot {
  version: 1
  dialect: Dialect
  tables: Record<string, TableSnapshot>
  /** ENUM types declared via `pgEnum()`. PG-only; absent on other dialects. */
  enums?: Record<string, EnumSnapshot>
}
