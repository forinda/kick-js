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
  const prevCols = new Map(Object.entries(prev.columns))
  const nextCols = new Map(Object.entries(next.columns))

  const drops: string[] = []
  const adds: string[] = []
  for (const c of prevCols.keys()) if (!nextCols.has(c)) drops.push(c)
  for (const c of nextCols.keys()) if (!prevCols.has(c)) adds.push(c)

  // Rename heuristic — pair only if exactly one drop + one add with identical attrs.
  if (drops.length === 1 && adds.length === 1) {
    const before = prevCols.get(drops[0])!
    const after = nextCols.get(adds[0])!
    if (columnAttrsEqual(before, after)) {
      changes.push({ kind: 'renameColumn', table: next.name, from: drops[0], to: adds[0] })
      drops.length = 0
      adds.length = 0
    }
  }

  for (const c of drops) {
    changes.push({ kind: 'dropColumn', table: next.name, column: prevCols.get(c)! })
  }
  for (const c of adds) {
    changes.push({ kind: 'addColumn', table: next.name, column: nextCols.get(c)! })
  }

  // Common columns — alter detection
  for (const c of nextCols.keys()) {
    if (!prevCols.has(c)) continue
    const before = prevCols.get(c)!
    const after = nextCols.get(c)!
    if (!columnsEqual(before, after)) {
      changes.push({ kind: 'alterColumn', table: next.name, column: c, before, after })
    }
  }

  diffByName(
    prev.indexes,
    next.indexes,
    (i) => changes.push({ kind: 'dropIndex', table: next.name, index: i }),
    (i) => changes.push({ kind: 'addIndex', table: next.name, index: i }),
  )

  diffByName(
    prev.foreignKeys,
    next.foreignKeys,
    (f) => changes.push({ kind: 'dropForeignKey', table: next.name, fk: f }),
    (f) => changes.push({ kind: 'addForeignKey', table: next.name, fk: f }),
  )
}

function diffByName<T extends { name: string }>(
  prev: T[],
  next: T[],
  onDrop: (item: T) => void,
  onAdd: (item: T) => void,
) {
  const prevByName = new Map(prev.map((p) => [p.name, p]))
  const nextByName = new Map(next.map((n) => [n.name, n]))
  for (const [n, p] of prevByName) if (!nextByName.has(n)) onDrop(p)
  for (const [n, x] of nextByName) if (!prevByName.has(n)) onAdd(x)
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

function columnAttrsEqual(
  a: import('../snapshot/types').ColumnSnapshot,
  b: import('../snapshot/types').ColumnSnapshot,
): boolean {
  // Like columnsEqual but ignores name (since rename is *about* name change).
  return (
    a.type === b.type &&
    a.nullable === b.nullable &&
    a.default === b.default &&
    a.primaryKey === b.primaryKey
  )
}
