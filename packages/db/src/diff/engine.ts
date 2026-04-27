import type { SchemaSnapshot, TableSnapshot } from '../snapshot/types'
import type { Change, ChangeSet } from './types'

export function diff(prev: SchemaSnapshot, next: SchemaSnapshot): ChangeSet {
  const changes: Change[] = []

  const prevTables = new Set(Object.keys(prev.tables))
  const nextTables = new Set(Object.keys(next.tables))

  // Drops first (so FKs that depend on dropped tables are handled before drops below)
  for (const name of prevTables) {
    if (!nextTables.has(name)) {
      changes.push({ kind: 'dropTable', table: prev.tables[name] })
    }
  }

  // Creates second
  for (const name of nextTables) {
    if (!prevTables.has(name)) {
      changes.push({ kind: 'createTable', table: next.tables[name] })
    }
  }

  // Common tables — column/index/fk diff comes in Tasks 10-12
  for (const name of nextTables) {
    if (!prevTables.has(name)) continue
    diffTable(prev.tables[name], next.tables[name], changes)
  }

  return changes
}

function diffTable(prev: TableSnapshot, next: TableSnapshot, changes: Change[]) {
  const prevCols = new Set(Object.keys(prev.columns))
  const nextCols = new Set(Object.keys(next.columns))

  for (const c of prevCols) {
    if (!nextCols.has(c)) {
      changes.push({ kind: 'dropColumn', table: next.name, column: prev.columns[c] })
    }
  }
  for (const c of nextCols) {
    if (!prevCols.has(c)) {
      changes.push({ kind: 'addColumn', table: next.name, column: next.columns[c] })
      continue
    }
    const before = prev.columns[c]
    const after = next.columns[c]
    if (!columnsEqual(before, after)) {
      changes.push({ kind: 'alterColumn', table: next.name, column: c, before, after })
    }
  }
}

function columnsEqual(
  a: import('../snapshot/types').ColumnSnapshot,
  b: import('../snapshot/types').ColumnSnapshot,
): boolean {
  return (
    a.type === b.type &&
    a.nullable === b.nullable &&
    a.default === b.default &&
    a.primaryKey === b.primaryKey
  )
}
