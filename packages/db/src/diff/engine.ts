import { RemovedValueAsDefaultError } from '../errors'
import { pgPrimaryKeyName, primaryKeyOf, snapshotTableName } from '../snapshot/name'
import type { PolicySnapshot, SchemaSnapshot, TableSnapshot, ViewSnapshot } from '../snapshot/types'
import type { Change, ChangeSet, PrimaryKeyShape } from './types'

/**
 * Renames to apply instead of a drop and an add. Names are qualified
 * (`billing.invoices`) when the table lives in a schema.
 */
export interface RenameHints {
  /** Old table name → new table name. */
  tables?: Record<string, string>
  /** `<new table>.<old column>` → new column name. */
  columns?: Record<string, string>
}

export interface DiffOptions {
  renames?: RenameHints
  /**
   * When true, only `renames` pair a drop with an add; the one-drop,
   * one-add guess is off. Set once someone has answered for every candidate.
   */
  explicitRenames?: boolean
}

export function diff(
  prev: SchemaSnapshot,
  next: SchemaSnapshot,
  options: DiffOptions = {},
): ChangeSet {
  const changes: Change[] = []
  const tableRenames = Object.entries(options.renames?.tables ?? {})
  if (tableRenames.length > 0) prev = applyTableRenames(prev, next, tableRenames, changes)

  const prevTables = new Set(Object.keys(prev.tables))
  const nextTables = new Set(Object.keys(next.tables))

  // Schemas come first of all: a new enum or table inside `billing` needs
  // `CREATE SCHEMA billing` to have run. `IF NOT EXISTS` makes re-emission
  // harmless, so we only need "is it new to this diff", not exact tracking.
  // Never dropped — see the CreateSchema doc comment.
  const prevSchemas = new Set(prev.schemas ?? [])
  for (const schema of next.schemas ?? []) {
    if (!prevSchemas.has(schema)) changes.push({ kind: 'createSchema', schema })
  }

  // Enum diffs run BEFORE table operations on the create side (so a new
  // table referencing a new enum sees the type already exist) and AFTER
  // table operations on the drop side (so a dropped enum can't have
  // dangling column references). Order: createEnum → addEnumValue →
  // table changes → dropEnum (appended at the end).
  diffEnumsCreatePhase(prev, next, changes)

  // Drops first. A kept table's foreign key to a dropped one goes before it
  // (Postgres won't drop a table something still references), and dropped
  // tables go child before parent.
  const dropped = new Set([...prevTables].filter((n) => !nextTables.has(n)))
  for (const name of prevTables) {
    if (dropped.has(name)) continue
    for (const f of prev.tables[name].foreignKeys) {
      if (dropped.has(f.refTable)) {
        changes.push({ kind: 'dropForeignKey', table: snapshotTableName(prev.tables[name]), fk: f })
      }
    }
  }
  for (const name of childrenFirst(dropped, prev)) {
    changes.push({ kind: 'dropTable', table: prev.tables[name] })
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
      // A new table is empty and nothing writes to it yet: nothing to gain
      // from CONCURRENTLY, which also can't share the table's transaction.
      const { concurrently: _concurrently, ...index } = i
      changes.push({ kind: 'addIndex', table: name, index })
    }
  }
  for (const name of newTableNames) {
    for (const f of next.tables[name].foreignKeys) {
      changes.push({ kind: 'addForeignKey', table: name, fk: f })
    }
  }

  // Common tables — column/index/fk diff comes in Tasks 10-12
  // Every column rename first, so a foreign key into a renamed column of
  // another table compares as the same key (the database follows a rename).
  const renamed: Renames = {
    tables: new Map(tableRenames),
    columns: new Map(),
  }
  for (const name of nextTables) {
    if (!prevTables.has(name)) continue
    const tableRef = snapshotTableName(next.tables[name])
    renamed.columns.set(
      tableRef,
      columnRenames(prev.tables[name], next.tables[name], tableRef, options),
    )
  }
  for (const name of nextTables) {
    if (!prevTables.has(name)) continue
    diffTable(prev.tables[name], next.tables[name], changes, next.dialect, renamed, dropped)
  }

  // Drop enums after every dependent table change has been emitted.
  diffEnumsDropPhase(prev, next, changes)

  return withRowLevelSecurity(prev, next, withViews(prev, next, changes))
}

const policyKey = (p: PolicySnapshot) =>
  JSON.stringify([p.as, p.command, [...p.to].toSorted(), p.using ?? null, p.withCheck ?? null])

/**
 * Roles first; then policy drops, ahead of the table changes (Postgres won't
 * drop a column a policy uses); then, last of all, row-level security on and
 * off and policy creates. A table whose shape changes, or that a policy's SQL
 * names, has its policies dropped and re-created around the change.
 */
function withRowLevelSecurity(
  prev: SchemaSnapshot,
  next: SchemaSnapshot,
  changes: Change[],
): Change[] {
  const roles: Change[] = []
  for (const [name, role] of Object.entries(next.roles ?? {})) {
    const was = prev.roles?.[name]
    if (!was) roles.push({ kind: 'createRole', role })
    else if (JSON.stringify(was) !== JSON.stringify(role)) roles.push({ kind: 'alterRole', role })
  }

  // A rename doesn't touch policies: Postgres keeps them on the table, and
  // their expressions refer to it by identity, not by name.
  const touched = new Set(changes.filter((c) => c.kind !== 'renameTable').flatMap(touchedBy))
  // Policy drops run before the rename, so they name the table as it was.
  const renamedFrom = new Map<string, string>()
  for (const c of changes) if (c.kind === 'renameTable') renamedFrom.set(c.to, c.from)
  const drops: Change[] = []
  const creates: Change[] = []
  for (const [name, t] of Object.entries(next.tables)) {
    const before = prev.tables[name]
    const was = new Map((before?.policies ?? []).map((p) => [p.name, p]))
    const now = t.policies ?? []
    // Re-create every policy on a table this migration reshapes, or whose SQL names one that is.
    const reshaped = (p: PolicySnapshot) =>
      touched.has(name) ||
      [...touched].some((x) => mentions(`${p.using ?? ''} ${p.withCheck ?? ''}`, x))
    for (const [pname, p] of was) {
      const kept = now.find((q) => q.name === pname)
      if (!kept || policyKey(kept) !== policyKey(p) || reshaped(p)) {
        drops.push({ kind: 'dropPolicy', table: renamedFrom.get(name) ?? name, policy: p })
      }
    }
    const rlsBefore = before?.rls ?? null
    const rlsAfter = t.rls ?? null
    if (JSON.stringify(rlsBefore) !== JSON.stringify(rlsAfter)) {
      creates.push({ kind: 'setRowLevelSecurity', table: name, from: rlsBefore, to: rlsAfter })
    }
    for (const p of now) {
      const old = was.get(p.name)
      if (!old || policyKey(old) !== policyKey(p) || reshaped(p)) {
        creates.push({ kind: 'createPolicy', table: name, policy: p })
      }
    }
  }
  if (roles.length === 0 && drops.length === 0 && creates.length === 0) return changes
  return [...roles, ...drops, ...changes, ...creates]
}

/** Change kinds that don't alter a table's shape, so a view over it is unaffected. */
const SHAPE_NEUTRAL = new Set<Change['kind']>([
  'addIndex',
  'dropIndex',
  'setTableComment',
  'setColumnComment',
  'createSchema',
  'createEnum',
  'addEnumValue',
])

/** The tables (and views) a change alters, by qualified name. */
function touchedBy(change: Change): string[] {
  if (SHAPE_NEUTRAL.has(change.kind)) return []
  switch (change.kind) {
    case 'createTable':
    case 'dropTable':
      return [snapshotTableName(change.table)]
    case 'renameTable':
      return [change.from, change.to]
    case 'removeEnumValue':
      return change.affectedColumns.map((c) => c.table)
    default:
      return 'table' in change && typeof change.table === 'string' ? [change.table] : []
  }
}

/** Whether a view's SQL names a table or view: `orders`, `"orders"`, `billing.orders`. */
function mentions(definition: string, qualified: string): boolean {
  const bare = qualified.slice(qualified.lastIndexOf('.') + 1)
  const escaped = bare.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(^|[^\\w$])["\`]?${escaped}["\`]?($|[^\\w$])`, 'i').test(definition)
}

/**
 * Add view changes around the table changes: drops first (dependents before
 * what they select from), creates last (in declaration order). A view whose
 * SQL names a table this migration alters is dropped and re-created too:
 * Postgres won't alter a column a view uses, and SQLite's table rebuild
 * breaks on a view over the table. The same goes for a view over a view
 * that's re-created.
 */
function withViews(prev: SchemaSnapshot, next: SchemaSnapshot, changes: Change[]): Change[] {
  const before = prev.views ?? {}
  const after = next.views ?? {}
  if (Object.keys(before).length === 0 && Object.keys(after).length === 0) return changes

  const sameView = (a: ViewSnapshot, b: ViewSnapshot) =>
    a.definition === b.definition && !!a.materialized === !!b.materialized
  const recreate = new Set(
    Object.keys(after).filter((n) => !before[n] || !sameView(before[n]!, after[n]!)),
  )
  const dropped = Object.keys(before).filter((n) => !after[n])

  const touched = new Set(changes.flatMap(touchedBy))
  for (let grew = true; grew;) {
    grew = false
    const changed = [...touched, ...recreate, ...dropped]
    for (const [name, v] of Object.entries(after)) {
      if (recreate.has(name) || !before[name]) continue
      if (changed.some((t) => t !== name && mentions(v.definition, t))) {
        recreate.add(name)
        grew = true
      }
    }
  }

  const drops: Change[] = Object.keys(before)
    .filter((n) => !after[n] || (recreate.has(n) && before[n]))
    .toReversed()
    .map((n) => ({ kind: 'dropView', view: { ...before[n]!, name: n } }))
  const creates: Change[] = Object.keys(after)
    .filter((n) => recreate.has(n))
    .map((n) => ({ kind: 'createView', view: { ...after[n]!, name: n } }))

  // Index changes on a materialized view that stays.
  const indexChanges: Change[] = []
  for (const [name, v] of Object.entries(after)) {
    if (recreate.has(name) || !v.materialized) continue
    const was = new Map((before[name]?.indexes ?? []).map((i) => [i.name, i]))
    const now = new Map((v.indexes ?? []).map((i) => [i.name, i]))
    for (const [n, i] of was) {
      if (!now.has(n) || indexDefinition(now.get(n)!) !== indexDefinition(i)) {
        indexChanges.push({ kind: 'dropIndex', table: name, index: i })
      }
    }
    for (const [n, i] of now) {
      if (!was.has(n) || indexDefinition(was.get(n)!) !== indexDefinition(i)) {
        indexChanges.push({ kind: 'addIndex', table: name, index: i })
      }
    }
  }

  return [...drops, ...changes, ...creates, ...indexChanges]
}

/** `prev` with the given tables under their new names — to look for column renames inside them. */
export function withTableRenames(
  prev: SchemaSnapshot,
  next: SchemaSnapshot,
  renames: Record<string, string>,
): SchemaSnapshot {
  return applyTableRenames(prev, next, Object.entries(renames), [])
}

/**
 * `prev` with each renamed table under its new name, and a `renameTable` for
 * each. The tables then diff as one, so only what else changed is emitted.
 */
function applyTableRenames(
  prev: SchemaSnapshot,
  next: SchemaSnapshot,
  renames: [string, string][],
  changes: Change[],
): SchemaSnapshot {
  const tables = { ...prev.tables }
  for (const [from, to] of renames) {
    const table = tables[from]
    if (!table || next.tables[from] || !next.tables[to] || tables[to]) {
      throw new Error(
        `kickjs-db: cannot rename table ${from} to ${to} — the schema must have lost ${from} and gained ${to}`,
      )
    }
    if ((table.schema ?? null) !== (next.tables[to].schema ?? null)) {
      throw new Error(
        `kickjs-db: cannot rename table ${from} to ${to} — a rename stays in its schema`,
      )
    }
    changes.push({ kind: 'renameTable', from, to })
    delete tables[from]
    tables[to] = { ...table, name: next.tables[to].name }
  }
  return { ...prev, tables }
}

/** Drops that might be renames: each lists what it could have become. */
export interface RenameCandidates {
  tables: { from: string; to: string[] }[]
  columns: { table: string; from: string; to: string[] }[]
}

/**
 * Every dropped table that a created table could replace, and every dropped
 * column that a column added to the same table could replace — the cases
 * where a drop might really be a rename, so someone should say which.
 */
export function findRenameCandidates(prev: SchemaSnapshot, next: SchemaSnapshot): RenameCandidates {
  const droppedTables = Object.keys(prev.tables).filter((t) => !next.tables[t])
  const createdTables = Object.keys(next.tables).filter((t) => !prev.tables[t])
  const sameSchema = (a: string, b: string) =>
    (prev.tables[a].schema ?? null) === (next.tables[b].schema ?? null)
  const tables = droppedTables
    .map((from) => ({ from, to: createdTables.filter((to) => sameSchema(from, to)) }))
    .filter((c) => c.to.length > 0)

  const columns: RenameCandidates['columns'] = []
  for (const [name, after] of Object.entries(next.tables)) {
    const before = prev.tables[name]
    if (!before) continue
    const added = Object.keys(after.columns).filter((c) => !before.columns[c])
    if (added.length === 0) continue
    for (const from of Object.keys(before.columns)) {
      if (!after.columns[from]) columns.push({ table: name, from, to: added })
    }
  }
  return { tables, columns }
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

function diffTable(
  prev: TableSnapshot,
  next: TableSnapshot,
  changes: Change[],
  dialect: SchemaSnapshot['dialect'],
  renamed: Renames,
  /** Tables this diff drops: a foreign key to one was dropped before them. */
  dropped: ReadonlySet<string> = new Set(),
) {
  // Every `table:` field on a Change carries the QUALIFIED name — that is what
  // the emitters quote and what `invertChanges` matches dropTable against.
  // Using the bare `next.name` here emitted `ALTER TABLE "invoices"` for a
  // table that actually lives in `billing`, which resolves through search_path
  // to a different table (or nothing).
  const tableRef = snapshotTableName(next)
  const prevCols = new Map(Object.entries(prev.columns))
  const nextCols = new Map(Object.entries(next.columns))

  const renames = renamed.columns.get(tableRef) ?? new Map<string, string>()
  const drops = [...prevCols.keys()].filter((c) => !nextCols.has(c) && !renames.has(c))
  const adds = [...nextCols.keys()].filter(
    (c) => !prevCols.has(c) && ![...renames.values()].includes(c),
  )
  // The old column is compared as the new one, so a rename that also changes
  // the type is a rename plus an alter.
  for (const [from, to] of renames) {
    prevCols.set(to, { ...prevCols.get(from)!, name: to })
    prevCols.delete(from)
  }

  // Foreign keys, indexes and checks that change or go are dropped before any
  // column: a column can't be dropped while an index or key still uses it
  // (SQLite refuses; Postgres and MySQL drop them along, so a later DROP
  // would fail). Their replacements are added after the columns.
  const prevFks = new Map(prev.foreignKeys.map((f) => [f.name, f]))
  const nextFks = new Map(next.foreignKeys.map((f) => [f.name, f]))
  for (const [n, f] of prevFks) {
    const after = nextFks.get(n)
    if (dropped.has(f.refTable)) continue
    if (!after || fkDefinition(after) !== fkDefinition(renamedFk(f, tableRef, renamed))) {
      changes.push({ kind: 'dropForeignKey', table: tableRef, fk: f })
    }
  }
  const prevIndexes = new Map(prev.indexes.map((i) => [i.name, i]))
  const nextIndexes = new Map(next.indexes.map((i) => [i.name, i]))
  // An index whose definition changed is dropped and created again — there
  // is no ALTER for its keys, predicate or method.
  for (const [n, i] of prevIndexes) {
    const after = nextIndexes.get(n)
    const was = { ...i, columns: i.columns.map((c) => renames.get(c) ?? c) }
    if (!after || indexDefinition(after) !== indexDefinition(was)) {
      // A rebuild of a concurrently-built index drops it concurrently too.
      const index = after?.concurrently && !i.concurrently ? { ...i, concurrently: true } : i
      changes.push({ kind: 'dropIndex', table: tableRef, index })
    }
  }
  // A CHECK whose expression changed is dropped and added again.
  const prevChecks = new Map(prev.checks.map((c) => [c.name, c]))
  const nextChecks = new Map(next.checks.map((c) => [c.name, c]))
  for (const [n, c] of prevChecks) {
    if (nextChecks.get(n)?.expression !== c.expression) {
      changes.push({ kind: 'dropCheck', table: tableRef, check: c })
    }
  }

  // Renames after those drops, so a down migration — the changes inverted, in
  // reverse — renames back before re-adding a key or index on the old name.
  for (const [from, to] of renames) {
    changes.push({ kind: 'renameColumn', table: tableRef, from, to })
  }

  // The primary key is compared as a whole (columns in key order, and the
  // name on Postgres, the only dialect that keeps one) and changed in two
  // steps: the old key goes before any column is dropped (Postgres drops a
  // key with its column, so a later DROP CONSTRAINT would fail), the new one
  // comes after columns are added and altered. Column alters ignore the
  // per-column flag.
  const pk = primaryKeyChange(prev, next, dialect)
  if (pk && pk.before.columns.length > 0) {
    changes.push({
      kind: 'alterPrimaryKey',
      table: tableRef,
      before: pk.before,
      after: { columns: [] },
    })
  }

  for (const c of drops) {
    changes.push({ kind: 'dropColumn', table: tableRef, column: prevCols.get(c)! })
  }
  for (const c of adds) {
    changes.push({ kind: 'addColumn', table: tableRef, column: nextCols.get(c)! })
  }

  // Common columns — alter detection
  for (const c of nextCols.keys()) {
    if (!prevCols.has(c)) continue
    const before = prevCols.get(c)!
    const after = nextCols.get(c)!
    if (!columnsEqual(before, after)) {
      changes.push({ kind: 'alterColumn', table: tableRef, column: c, before, after })
    }
    // A comment is its own change: on SQLite it isn't stored, and an
    // alterColumn there would rebuild the table for nothing.
    if ((before.comment ?? null) !== (after.comment ?? null)) {
      changes.push({
        kind: 'setColumnComment',
        table: tableRef,
        column: after,
        from: before.comment ?? null,
        to: after.comment ?? null,
      })
    }
  }

  if (pk && pk.after.columns.length > 0) {
    changes.push({
      kind: 'alterPrimaryKey',
      table: tableRef,
      before: { columns: [] },
      after: pk.after,
    })
  }

  for (const [n, c] of nextChecks) {
    if (prevChecks.get(n)?.expression !== c.expression) {
      changes.push({ kind: 'addCheck', table: tableRef, check: c })
    }
  }
  for (const [n, i] of nextIndexes) {
    const before = prevIndexes.get(n)
    const was = before && { ...before, columns: before.columns.map((c) => renames.get(c) ?? c) }
    if (!was || indexDefinition(was) !== indexDefinition(i)) {
      changes.push({ kind: 'addIndex', table: tableRef, index: i })
    }
  }
  for (const [n, f] of nextFks) {
    const before = prevFks.get(n)
    if (!before || fkDefinition(renamedFk(before, tableRef, renamed)) !== fkDefinition(f)) {
      changes.push({ kind: 'addForeignKey', table: tableRef, fk: f })
    }
  }

  if ((prev.comment ?? null) !== (next.comment ?? null)) {
    changes.push({
      kind: 'setTableComment',
      table: tableRef,
      from: prev.comment ?? null,
      to: next.comment ?? null,
    })
  }
}

/** The renames one diff makes: tables (old → new) and, per table, columns. */
interface Renames {
  tables: Map<string, string>
  columns: Map<string, Map<string, string>>
}

/**
 * A table's column renames, old → new: those named in `renames`, else a
 * single dropped column whose one replacement has the same attributes.
 */
function columnRenames(
  prev: TableSnapshot,
  next: TableSnapshot,
  tableRef: string,
  options: DiffOptions,
): Map<string, string> {
  const drops = Object.keys(prev.columns).filter((c) => !(c in next.columns))
  const adds = Object.keys(next.columns).filter((c) => !(c in prev.columns))
  const out = new Map<string, string>()
  for (const [key, to] of Object.entries(options.renames?.columns ?? {})) {
    const dot = key.lastIndexOf('.')
    if (key.slice(0, dot) !== tableRef) continue
    const from = key.slice(dot + 1)
    if (!drops.includes(from) || !adds.includes(to)) {
      throw new Error(
        `kickjs-db: cannot rename ${tableRef}.${from} to ${to} — ` +
          `${tableRef} must have lost ${from} and gained ${to}`,
      )
    }
    out.set(from, to)
  }
  const leftDrops = drops.filter((c) => !out.has(c))
  const leftAdds = adds.filter((c) => ![...out.values()].includes(c))
  if (
    !options.explicitRenames &&
    out.size === 0 &&
    leftDrops.length === 1 &&
    leftAdds.length === 1
  ) {
    if (columnAttrsEqual(prev.columns[leftDrops[0]!]!, next.columns[leftAdds[0]!]!)) {
      out.set(leftDrops[0]!, leftAdds[0]!)
    }
  }
  return out
}

/** A foreign key as it reads after this diff's renames, of its table, target and target's columns. */
function renamedFk(
  f: import('../snapshot/types').ForeignKeySnapshot,
  tableRef: string,
  renamed: Renames,
): import('../snapshot/types').ForeignKeySnapshot {
  const own = renamed.columns.get(tableRef)
  const refTable = renamed.tables.get(f.refTable) ?? f.refTable
  const ref = renamed.columns.get(refTable)
  return {
    ...f,
    columns: f.columns.map((c) => own?.get(c) ?? c),
    refTable,
    refColumns: f.refColumns.map((c) => ref?.get(c) ?? c),
  }
}

/**
 * Dropped tables ordered so a table goes before any table it references.
 * ponytail: a reference cycle keeps declaration order for what's left.
 */
function childrenFirst(dropped: ReadonlySet<string>, prev: SchemaSnapshot): string[] {
  const left = [...dropped]
  const out: string[] = []
  while (left.length > 0) {
    // A table no other remaining table references can go now.
    const i = left.findIndex(
      (t) =>
        !left.some((o) => o !== t && prev.tables[o]!.foreignKeys.some((f) => f.refTable === t)),
    )
    out.push(...left.splice(i === -1 ? 0 : i, 1))
  }
  return out
}

/** What makes two foreign keys the same key: a changed action or target is a new one. */
function fkDefinition(f: import('../snapshot/types').ForeignKeySnapshot): string {
  const { name: _name, ...rest } = f
  return JSON.stringify(Object.entries(rest).toSorted(([a], [b]) => a.localeCompare(b)))
}

/** What makes two indexes the same index. `concurrently` is how it is built, not what it is. */
function indexDefinition(i: import('../snapshot/types').IndexSnapshot): string {
  return JSON.stringify([
    i.columns,
    i.unique,
    i.where ?? null,
    // btree is the default everywhere, so naming it changes nothing.
    i.using && i.using.toLowerCase() !== 'btree' ? i.using.toLowerCase() : null,
    i.include ?? [],
    Object.entries(i.opclasses ?? {}).toSorted(([a], [b]) => a.localeCompare(b)),
  ])
}

function columnsEqual(
  a: import('../snapshot/types').ColumnSnapshot,
  b: import('../snapshot/types').ColumnSnapshot,
): boolean {
  // `primaryKey` is left to `alterPrimaryKey`: an alterColumn for it made
  // Postgres emit nothing for the key and MySQL a MODIFY COLUMN that neither
  // added nor dropped it.
  return (
    a.type === b.type &&
    a.nullable === b.nullable &&
    a.default === b.default &&
    a.identity === b.identity &&
    a.generated?.expression === b.generated?.expression &&
    a.generated?.stored === b.generated?.stored
  )
}

function primaryKeyChange(
  prev: TableSnapshot,
  next: TableSnapshot,
  dialect: SchemaSnapshot['dialect'],
): { before: PrimaryKeyShape; after: PrimaryKeyShape } | null {
  const shape = (t: TableSnapshot): PrimaryKeyShape => {
    const pk = primaryKeyOf(t)
    // Only Postgres keeps a primary key's name; elsewhere it's not part of the key.
    return dialect === 'postgres' && pk.columns.length > 0
      ? { name: pgPrimaryKeyName(t), columns: pk.columns }
      : { columns: pk.columns }
  }
  const before = shape(prev)
  const after = shape(next)
  const same = before.name === after.name && before.columns.join('\0') === after.columns.join('\0')
  return same ? null : { before, after }
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
