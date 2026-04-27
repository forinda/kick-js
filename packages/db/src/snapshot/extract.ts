import type { ColumnBuilder } from '../dsl/columns/types'
import type { TableDecl } from '../dsl/table'
import type {
  Dialect,
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

export function extractSnapshot(schema: Record<string, unknown>, dialect: Dialect): SchemaSnapshot {
  const tables: Record<string, TableSnapshot> = {}

  for (const value of Object.values(schema)) {
    if (!isTable(value)) continue
    tables[value.__name] = extractTable(value)
  }

  return { version: 1, dialect, tables }
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
      foreignKeys.push({
        name: `${t.__name}_${colKey}_fk`,
        columns: [colKey],
        refTable: state.references.table,
        refColumns: [state.references.column],
        onDelete: state.references.onDelete as ForeignKeySnapshot['onDelete'],
        onUpdate: state.references.onUpdate as ForeignKeySnapshot['onUpdate'],
      })
    }
  }

  return { name: t.__name, columns, indexes, foreignKeys, checks: [] }
}
