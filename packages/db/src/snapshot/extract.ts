import type { ColumnBuilder } from '../dsl/columns/types'
import type { TableDecl } from '../dsl/table'
import { extractRelations } from '../query/extract-relations'
import type {
  Dialect,
  EnumSnapshot,
  ForeignKeySnapshot,
  IndexSnapshot,
  SchemaSnapshot,
  TableSnapshot,
} from './types'

interface MaybeTable {
  __isTable?: boolean
  __name?: string
  __columns?: Record<string, ColumnBuilder>
  __indexes?: IndexSnapshot[]
}

function isTable(v: unknown): v is TableDecl<string, Record<string, ColumnBuilder>> {
  return Boolean(v && typeof v === 'object' && (v as MaybeTable).__isTable === true)
}

/**
 * pgEnum() returns a function with `enumName` + `values` attached.
 * Detect via duck-typing rather than `instanceof` so the snapshot
 * code stays decoupled from the PG-specific module — the snapshot
 * pipeline runs for every dialect.
 */
interface MaybePgEnum {
  enumName?: unknown
  values?: unknown
}

function isPgEnum(v: unknown): v is { enumName: string; values: readonly string[] } {
  if (typeof v !== 'function') return false
  const f = v as MaybePgEnum
  return typeof f.enumName === 'string' && Array.isArray(f.values)
}

export function extractSnapshot(schema: Record<string, unknown>, dialect: Dialect): SchemaSnapshot {
  const tables: Record<string, TableSnapshot> = {}
  const enums: Record<string, EnumSnapshot> = {}

  for (const value of Object.values(schema)) {
    if (isTable(value)) {
      tables[value.__name] = extractTable(value)
    } else if (isPgEnum(value)) {
      enums[value.enumName] = { name: value.enumName, values: [...value.values] }
    }
  }

  const relations = extractRelations(schema, tables)

  // Only carry `enums` on PG snapshots — other dialects don't define
  // them and an empty record would just bloat the diff output.
  // `relations` is dialect-agnostic (query-time sugar) but we still
  // omit it when absent to keep snapshots minimal for adopters who
  // don't use the relational query layer.
  const snapshot: SchemaSnapshot = { version: 1, dialect, tables }
  if (dialect === 'postgres' && Object.keys(enums).length > 0) {
    snapshot.enums = enums
  }
  if (relations) {
    snapshot.relations = relations
  }
  return snapshot
}

function extractTable(t: TableDecl<string, Record<string, ColumnBuilder>>): TableSnapshot {
  const columns: TableSnapshot['columns'] = {}
  const indexes: IndexSnapshot[] = [...t.__indexes]
  const foreignKeys: ForeignKeySnapshot[] = []

  for (const [colKey, builder] of Object.entries(t.__columns)) {
    columns[colKey] = builder.toJSON(colKey)
    const state = builder.__state()
    if (state.unique) {
      indexes.push({
        name: `${t.__name}_${colKey}_unique`,
        columns: [colKey],
        unique: true,
      })
    }
    if (state.references) {
      // Resolve the FK thunk lazily — by extract time the table const has
      // been bound, so self-references (`() => self.id`) work.
      const ref = state.references.thunk()
      foreignKeys.push({
        name: `${t.__name}_${colKey}_fk`,
        columns: [colKey],
        refTable: ref.__tableName,
        refColumns: [ref.__name],
        onDelete: state.references.onDelete,
        onUpdate: state.references.onUpdate,
      })
    }
  }

  return { name: t.__name, columns, indexes, foreignKeys, checks: [] }
}
