import { diff } from '../diff/engine'
import type { Change } from '../diff/types'
import type {
  ColumnSnapshot,
  Dialect,
  ForeignKeySnapshot,
  SchemaSnapshot,
  TableSnapshot,
} from '../snapshot/types'
import { sqliteType } from '../emit/sqlite'
import { mysqlType } from '../emit/mysql'
import { MigrationDriftError, type SchemaDiffSummary } from './errors'

/**
 * SQLite and MySQL introspection is lossy against a code-first snapshot: a
 * `uuid()` column reads back as `text` / `char(36)`, default expressions
 * store in a normalised form, and SQLite doesn't preserve FK names.
 * Comparing the raw snapshots would flag drift on every migration.
 *
 * To get meaningful drift on those dialects we canonicalise BOTH sides
 * into the same shape before diffing: column types run through the emit
 * type-mapper (so `uuid` and `text` collapse together), defaults are
 * dropped (too divergent to align reliably), and FK names become a
 * structural key. This still catches the drift that matters — tables /
 * columns added or removed, type / nullability / PK changes, indexes —
 * without false positives. PostgreSQL round-trips faithfully, so it is
 * compared raw and keeps default-level drift detection.
 */
function normalizeForDrift(snap: SchemaSnapshot): SchemaSnapshot {
  if (snap.dialect === 'postgres') return snap

  const tables: Record<string, TableSnapshot> = {}
  for (const [name, t] of Object.entries(snap.tables)) {
    const columns: Record<string, ColumnSnapshot> = {}
    for (const [cn, c] of Object.entries(t.columns)) {
      columns[cn] = { ...c, type: canonicalType(c.type, snap.dialect), default: null }
    }
    tables[name] = { ...t, columns, foreignKeys: t.foreignKeys.map(canonicalFk) }
  }
  return { ...snap, tables }
}

function canonicalType(type: string, dialect: Dialect): string {
  if (dialect === 'sqlite') return sqliteType(type).toLowerCase()
  if (dialect === 'mysql') return mysqlType(type).toLowerCase()
  return type
}

/** Replace the FK name with a structural key (SQLite synthesizes names). */
function canonicalFk(fk: ForeignKeySnapshot): ForeignKeySnapshot {
  return {
    name: `${fk.columns.join(',')}=>${fk.refTable}(${fk.refColumns.join(',')})`,
    columns: fk.columns,
    refTable: fk.refTable,
    refColumns: fk.refColumns,
    onDelete: fk.onDelete,
    onUpdate: fk.onUpdate,
  }
}

export type DriftBehavior = 'error' | 'warn' | 'ignore'

export interface DriftLogger {
  warn: (message: string) => void
}

export async function checkDrift(
  liveSnapshot: SchemaSnapshot,
  expectedSnapshot: SchemaSnapshot,
  behavior: DriftBehavior,
  log: DriftLogger = console,
): Promise<void> {
  if (behavior === 'ignore') return
  // diff(prev, next) reads expected as `prev` and live as `next` so 'added'
  // means "live has it but the snapshot doesn't" — i.e. someone ran DDL
  // outside the migration runner. Both sides are canonicalised first so
  // SQLite/MySQL's lossy introspection doesn't flag phantom drift.
  const changes = diff(normalizeForDrift(expectedSnapshot), normalizeForDrift(liveSnapshot))
  if (changes.length === 0) return

  const summary = summarize(changes)
  const message = `Schema drift detected: ${summary.added.length} added, ${summary.removed.length} removed, ${summary.changed.length} changed`
  if (behavior === 'warn') {
    log.warn(message)
    return
  }
  throw new MigrationDriftError(message, summary)
}

function summarize(changes: Change[]): SchemaDiffSummary {
  const added: string[] = []
  const removed: string[] = []
  const changed: string[] = []
  for (const c of changes) {
    switch (c.kind) {
      case 'createTable':
        added.push(c.table.name)
        break
      case 'dropTable':
        removed.push(c.table.name)
        break
      case 'addColumn':
        added.push(`${c.table}.${c.column.name}`)
        break
      case 'dropColumn':
        removed.push(`${c.table}.${c.column.name}`)
        break
      case 'alterColumn':
        changed.push(`${c.table}.${c.column}`)
        break
      case 'renameColumn':
        changed.push(`${c.table}.${c.from}→${c.to}`)
        break
      case 'renameTable':
        changed.push(`${c.from}→${c.to}`)
        break
      case 'addIndex':
        added.push(`${c.table}#${c.index.name}`)
        break
      case 'dropIndex':
        removed.push(`${c.table}#${c.index.name}`)
        break
      case 'addForeignKey':
        added.push(`${c.table}!${c.fk.name}`)
        break
      case 'dropForeignKey':
        removed.push(`${c.table}!${c.fk.name}`)
        break
    }
  }
  return { added, removed, changed }
}
