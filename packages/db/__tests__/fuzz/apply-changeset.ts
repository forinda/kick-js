import type { ChangeSet, EnumSnapshot, SchemaSnapshot, TableSnapshot } from '@forinda/kickjs-db'

// Fuzz-harness companion to `emitPg` — applies a ChangeSet to an
// in-memory SchemaSnapshot so the round-trip property
// `applyChangeSet(A, diff(A, B)) ≡ B` can be asserted without
// rendering to SQL + executing against a real DB.
//
// Scope mirrors the generator (`random-schema.ts`):
// - Handles every Change kind the diff engine emits.
// - Mutates a deep clone so callers can compare apply-result vs
//   target without sharing references with the source.
// - Ambiguous-reverse cases (alterColumn on non-equal before/after,
//   addEnumValue, removeEnumValue) round-trip on the forward side
//   but not the invert side. The fuzz test skips invert assertions
//   on those.

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value))
}

export function applyChangeSet(snapshot: SchemaSnapshot, changes: ChangeSet): SchemaSnapshot {
  const out = deepClone(snapshot)
  for (const change of changes) applyOne(out, change)
  return out
}

function applyOne(snapshot: SchemaSnapshot, change: ChangeSet[number]): void {
  switch (change.kind) {
    case 'createTable':
      // Mirror `emitCreateTable` in `emit/pg.ts` — the CREATE TABLE
      // SQL only includes columns + PK. Indexes and foreign keys
      // land via the separate `addIndex` / `addForeignKey` changes
      // the engine emits in pass 2 + pass 3 (see `diff/engine.ts`).
      // Take the table's base shape only here; the secondary
      // changes downstream populate the rest.
      snapshot.tables[change.table.name] = {
        ...deepClone(change.table),
        indexes: [],
        foreignKeys: [],
      }
      return
    case 'dropTable':
      delete snapshot.tables[change.table.name]
      return
    case 'renameTable': {
      const t = snapshot.tables[change.from]
      if (!t) return
      delete snapshot.tables[change.from]
      snapshot.tables[change.to] = { ...t, name: change.to }
      return
    }
    case 'addColumn': {
      const t = snapshot.tables[change.table]
      if (!t) return
      t.columns[change.column.name] = deepClone(change.column)
      return
    }
    case 'dropColumn': {
      const t = snapshot.tables[change.table]
      if (!t) return
      delete t.columns[change.column.name]
      return
    }
    case 'renameColumn': {
      const t = snapshot.tables[change.table]
      if (!t) return
      const col = t.columns[change.from]
      if (!col) return
      delete t.columns[change.from]
      t.columns[change.to] = { ...col, name: change.to }
      return
    }
    case 'alterColumn': {
      const t = snapshot.tables[change.table]
      if (!t) return
      t.columns[change.column] = deepClone(change.after)
      return
    }
    case 'addIndex': {
      const t = snapshot.tables[change.table]
      if (!t) return
      t.indexes.push(deepClone(change.index))
      return
    }
    case 'dropIndex': {
      const t = snapshot.tables[change.table]
      if (!t) return
      t.indexes = t.indexes.filter((i) => i.name !== change.index.name)
      return
    }
    case 'addForeignKey': {
      const t = snapshot.tables[change.table]
      if (!t) return
      t.foreignKeys.push(deepClone(change.fk))
      return
    }
    case 'dropForeignKey': {
      const t = snapshot.tables[change.table]
      if (!t) return
      t.foreignKeys = t.foreignKeys.filter((f) => f.name !== change.fk.name)
      return
    }
    case 'createEnum': {
      if (!snapshot.enums) snapshot.enums = {}
      const e: EnumSnapshot = { name: change.enum.name, values: [...change.enum.values] }
      snapshot.enums[change.enum.name] = e
      return
    }
    case 'dropEnum': {
      if (!snapshot.enums) return
      delete snapshot.enums[change.enum.name]
      if (Object.keys(snapshot.enums).length === 0) delete snapshot.enums
      return
    }
    case 'addEnumValue': {
      if (!snapshot.enums) return
      const e = snapshot.enums[change.enum]
      if (!e) return
      const idx = change.before != null ? e.values.indexOf(change.before) : -1
      const next = [...e.values]
      if (idx >= 0) next.splice(idx, 0, change.value)
      else next.push(change.value)
      snapshot.enums[change.enum] = { name: e.name, values: next }
      return
    }
    case 'removeEnumValue': {
      if (!snapshot.enums) return
      const e = snapshot.enums[change.enum]
      if (!e) return
      const removed = new Set(change.removed)
      snapshot.enums[change.enum] = {
        name: e.name,
        values: e.values.filter((v) => !removed.has(v)),
      }
      return
    }
    case 'createSchema': {
      // Mirrors extractSnapshot: `schemas` is sorted and only present when
      // non-empty, so the fuzz round-trip stays an exact comparison. There is
      // no dropSchema variant to mirror — schemas are never removed.
      const schemas = new Set(snapshot.schemas ?? [])
      schemas.add(change.schema)
      snapshot.schemas = [...schemas].toSorted()
      return
    }
    case 'alterPrimaryKey': {
      const t = snapshot.tables[change.table]
      if (!t) return
      // The diff splits a key change: before-only drops, after-only adds.
      for (const c of change.before.columns) if (t.columns[c]) t.columns[c].primaryKey = false
      if (change.before.columns.length > 0) delete t.primaryKey
      for (const c of change.after.columns) if (t.columns[c]) t.columns[c].primaryKey = true
      // Only a non-default name survives as a table-level key; the fuzzer's
      // snapshots declare keys on columns, so column order needs no record.
      if (change.after.name && change.after.name !== `${t.name}_pkey`) {
        t.primaryKey = { name: change.after.name, columns: [...change.after.columns] }
      }
      return
    }
    case 'addCheck': {
      const t = snapshot.tables[change.table]
      if (!t) return
      t.checks.push(deepClone(change.check))
      return
    }
    case 'dropCheck': {
      const t = snapshot.tables[change.table]
      if (!t) return
      t.checks = t.checks.filter((c) => c.name !== change.check.name)
      return
    }
    case 'createRole':
    case 'alterRole': {
      snapshot.roles = { ...snapshot.roles, [change.role.name]: deepClone(change.role) }
      return
    }
    case 'setRowLevelSecurity': {
      const t = snapshot.tables[change.table]
      if (!t) return
      if (change.to) t.rls = deepClone(change.to)
      else delete t.rls
      return
    }
    case 'createPolicy': {
      const t = snapshot.tables[change.table]
      if (!t) return
      t.policies = [
        ...(t.policies ?? []).filter((p) => p.name !== change.policy.name),
        deepClone(change.policy),
      ]
      return
    }
    case 'dropPolicy': {
      const t = snapshot.tables[change.table]
      if (!t) return
      t.policies = (t.policies ?? []).filter((p) => p.name !== change.policy.name)
      if (t.policies.length === 0) delete t.policies
      return
    }
    case 'createView': {
      snapshot.views = { ...snapshot.views, [change.view.name]: deepClone(change.view) }
      return
    }
    case 'dropView': {
      if (snapshot.views) delete snapshot.views[change.view.name]
      return
    }
    case 'setTableComment': {
      const t = snapshot.tables[change.table]
      if (!t) return
      if (change.to === null) delete t.comment
      else t.comment = change.to
      return
    }
    case 'setColumnComment': {
      const col = snapshot.tables[change.table]?.columns[change.column.name]
      if (!col) return
      if (change.to === null) delete col.comment
      else col.comment = change.to
      return
    }
    default: {
      // Exhaustiveness guard: a new Change variant added without
      // an applier case here would silently no-op and make the
      // fuzz round-trip assertions misleading. Asserting `change`
      // is `never` turns it into a TS compile error instead.
      const _exhaustive: never = change
      return _exhaustive
    }
  }
}

/**
 * Snapshot equality for fuzz assertions. Tables compared as keyed
 * records (insertion order irrelevant); indexes / FKs / enum values
 * compared as multisets keyed by `name` so apply-order differences
 * within a ChangeSet don't false-positive.
 */
export function snapshotsEqual(a: SchemaSnapshot, b: SchemaSnapshot): boolean {
  if (a.version !== b.version || a.dialect !== b.dialect) return false
  const aTables = Object.keys(a.tables).toSorted()
  const bTables = Object.keys(b.tables).toSorted()
  if (aTables.join(',') !== bTables.join(',')) return false
  for (const name of aTables) {
    if (!tablesEqual(a.tables[name] as TableSnapshot, b.tables[name] as TableSnapshot)) return false
  }
  const aEnumKeys = Object.keys(a.enums ?? {}).toSorted()
  const bEnumKeys = Object.keys(b.enums ?? {}).toSorted()
  if (aEnumKeys.join(',') !== bEnumKeys.join(',')) return false
  for (const name of aEnumKeys) {
    const ea = a.enums?.[name] as EnumSnapshot
    const eb = b.enums?.[name] as EnumSnapshot
    if (ea.values.join(',') !== eb.values.join(',')) return false
  }
  return true
}

function tablesEqual(a: TableSnapshot, b: TableSnapshot): boolean {
  if (a.name !== b.name) return false
  const aCols = Object.keys(a.columns).toSorted()
  const bCols = Object.keys(b.columns).toSorted()
  if (aCols.join(',') !== bCols.join(',')) return false
  for (const c of aCols) {
    if (JSON.stringify(a.columns[c]) !== JSON.stringify(b.columns[c])) return false
  }
  if (!nameSetEqual(a.indexes, b.indexes)) return false
  if (!nameSetEqual(a.foreignKeys, b.foreignKeys)) return false
  return true
}

function nameSetEqual<T extends { name: string }>(a: readonly T[], b: readonly T[]): boolean {
  if (a.length !== b.length) return false
  const aByName = new Map(a.map((x) => [x.name, JSON.stringify(x)]))
  for (const x of b) {
    if (aByName.get(x.name) !== JSON.stringify(x)) return false
  }
  return true
}
