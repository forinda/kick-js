import { RemovedValueAsDefaultError } from '../errors'
import type { SchemaSnapshot, TableSnapshot } from '../snapshot/types'
import type { Change, ChangeSet } from './types'

export function diff(prev: SchemaSnapshot, next: SchemaSnapshot): ChangeSet {
  const changes: Change[] = []

  const prevTables = new Set(Object.keys(prev.tables))
  const nextTables = new Set(Object.keys(next.tables))

  // Enum diffs run BEFORE table operations on the create side (so a new
  // table referencing a new enum sees the type already exist) and AFTER
  // table operations on the drop side (so a dropped enum can't have
  // dangling column references). Order: createEnum → addEnumValue →
  // table changes → dropEnum (appended at the end).
  diffEnumsCreatePhase(prev, next, changes)

  // Drops first (so FKs that depend on dropped tables are handled before drops below)
  for (const name of prevTables) {
    if (!nextTables.has(name)) {
      changes.push({ kind: 'dropTable', table: prev.tables[name] })
    }
  }

  // Creates — three passes so secondary objects only land after every new
  // table exists. Pass 1: every CREATE TABLE. Pass 2: every CREATE INDEX.
  // Pass 3: every ADD FOREIGN KEY. This keeps the order safe regardless of
  // ESM namespace iteration (which is alphabetical, not declaration order)
  // and lets each change kind map 1:1 to a SQL statement.
  const newTableNames = [...nextTables].filter((n) => !prevTables.has(n))
  for (const name of newTableNames) {
    changes.push({ kind: 'createTable', table: next.tables[name] })
  }
  for (const name of newTableNames) {
    for (const i of next.tables[name].indexes) {
      changes.push({ kind: 'addIndex', table: name, index: i })
    }
  }
  for (const name of newTableNames) {
    for (const f of next.tables[name].foreignKeys) {
      changes.push({ kind: 'addForeignKey', table: name, fk: f })
    }
  }

  // Common tables — column/index/fk diff comes in Tasks 10-12
  for (const name of nextTables) {
    if (!prevTables.has(name)) continue
    diffTable(prev.tables[name], next.tables[name], changes)
  }

  // Drop enums after every dependent table change has been emitted.
  diffEnumsDropPhase(prev, next, changes)

  return changes
}

function diffEnumsCreatePhase(prev: SchemaSnapshot, next: SchemaSnapshot, changes: Change[]) {
  const prevEnums = prev.enums ?? {}
  const nextEnums = next.enums ?? {}

  // New enums first.
  for (const [name, e] of Object.entries(nextEnums)) {
    if (prevEnums[name]) continue
    changes.push({ kind: 'createEnum', enum: e })
  }

  // ALTER TYPE ADD VALUE for non-destructive value additions on
  // existing enums. Removed values are NOT round-trippable without
  // dropping every column that references the type — those surface
  // as a `removeEnumValue` advisory the emitter turns into a SQL
  // comment with explicit operator guidance.
  for (const [name, e] of Object.entries(nextEnums)) {
    const prior = prevEnums[name]
    if (!prior) continue
    const priorValues = new Set(prior.values)
    const nextValues = new Set(e.values)
    const nextValueList = e.values

    let lastInsertedAt = -1
    for (let i = 0; i < nextValueList.length; i++) {
      const value = nextValueList[i]
      if (priorValues.has(value)) {
        lastInsertedAt = i
        continue
      }
      // New value — emit ADD VALUE. PG honours the BEFORE clause so
      // we preserve the declaration order on existing values.
      const before = nextValueList[i + 1]
      const beforeIsExisting = before != null && priorValues.has(before)
      changes.push({
        kind: 'addEnumValue',
        enum: name,
        value,
        ...(beforeIsExisting ? { before } : {}),
      })
      void lastInsertedAt
    }

    // Removed values — collect in declaration order from the prior
    // snapshot so the emitter list matches the order the operator
    // originally wrote.
    const removed = prior.values.filter((v) => !nextValues.has(v))
    if (removed.length > 0) {
      const affectedColumns = collectColumnsByEnumType(next, name)
      // M5.A.1 — pull each affected column's default off the PRIOR
      // snapshot. The default is what the column had before the
      // migration; we restore it (cast through the new type) after
      // the type swap. Reading from `prev` keeps the dance idempotent
      // with respect to schema-author intent.
      // In-place assign — collectColumnsByEnumType builds fresh objects,
      // so mutating them here is safe and skips a per-entry spread copy.
      const affectedColumnsWithDefaults = affectedColumns.map((c) =>
        Object.assign(c, { default: readPriorDefault(prev, c.table, c.column) }),
      )
      // Refuse at diff time when the column's default is being dropped
      // from the enum. The operator must update the column default
      // in the schema first.
      for (const c of affectedColumnsWithDefaults) {
        if (c.default == null) continue
        const literal = stripDefaultCast(c.default)
        if (literal != null && removed.includes(literal)) {
          throw new RemovedValueAsDefaultError(name, c.table, c.column, literal)
        }
      }
      changes.push({
        kind: 'removeEnumValue',
        enum: name,
        removed,
        values: nextValueList,
        affectedColumns: affectedColumnsWithDefaults,
      })
    }
  }
}

/**
 * Walk the next snapshot for columns whose declared type matches the
 * enum being modified. The emitter rewrites each via
 * `ALTER TABLE … ALTER COLUMN … TYPE foo USING column::text::foo`
 * inside the rename-recreate block.
 */
function collectColumnsByEnumType(
  snapshot: SchemaSnapshot,
  enumName: string,
): { table: string; column: string }[] {
  const out: { table: string; column: string }[] = []
  for (const [tableName, table] of Object.entries(snapshot.tables)) {
    for (const [columnName, column] of Object.entries(table.columns)) {
      if (column.type === enumName) {
        out.push({ table: tableName, column: columnName })
      }
    }
  }
  return out
}

/**
 * Pull the literal default expression off the prior-snapshot column.
 * Returns `null` when the table/column doesn't exist in `prev` (i.e.
 * a column added in the same diff that introduces the enum change).
 */
function readPriorDefault(
  prev: SchemaSnapshot,
  tableName: string,
  columnName: string,
): string | null {
  const table = prev.tables[tableName]
  if (!table) return null
  const column = table.columns[columnName]
  if (!column) return null
  return column.default
}

/**
 * Strip the optional PG `::"enum"` cast from a default expression to
 * recover the bare literal. Returns the literal sans outer single
 * quotes when it's a simple text default, or `null` for function
 * calls, complex expressions, or anything else that wouldn't be a
 * value in the enum.
 *
 * Used only for the M5.A.1 "default points at a removed value" check.
 */
function stripDefaultCast(expr: string): string | null {
  const noCast = expr.replace(/::\s*"?[a-zA-Z_][a-zA-Z0-9_]*"?\s*$/, '').trim()
  const match = /^'((?:[^']|'')*)'$/.exec(noCast)
  if (!match) return null
  return match[1]!.replace(/''/g, "'")
}

function diffEnumsDropPhase(prev: SchemaSnapshot, next: SchemaSnapshot, changes: Change[]) {
  const prevEnums = prev.enums ?? {}
  const nextEnums = next.enums ?? {}
  for (const [name, e] of Object.entries(prevEnums)) {
    if (nextEnums[name]) continue
    changes.push({ kind: 'dropEnum', enum: e })
  }
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
