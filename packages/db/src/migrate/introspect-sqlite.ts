import type {
  ColumnSnapshot,
  ForeignKeySnapshot,
  FkAction,
  IndexSnapshot,
  SchemaSnapshot,
  TableSnapshot,
} from '../snapshot/types'

const DEFAULT_EXCLUDED = ['kick_migrations', 'kick_migrations_lock']

/** Minimal better-sqlite3 surface introspection needs (sync `.all()`). */
export interface SqliteIntrospectDb {
  prepare(sql: string): { all<R = unknown>(...params: unknown[]): R[] }
}

export interface IntrospectSqliteOptions {
  excludeTables?: string[]
}

interface TableInfoRow {
  cid: number
  name: string
  type: string
  notnull: 0 | 1
  dflt_value: string | null
  pk: number
}

interface IndexListRow {
  seq: number
  name: string
  unique: 0 | 1
  origin: string // 'c' = CREATE INDEX, 'u' = UNIQUE constraint, 'pk' = primary key
  partial: 0 | 1
}

interface IndexInfoRow {
  seqno: number
  cid: number
  name: string | null
}

interface FkListRow {
  id: number
  seq: number
  table: string
  from: string
  to: string
  on_update: string
  on_delete: string
  match: string
}

/**
 * Read a live SQLite database into a {@link SchemaSnapshot} via
 * `sqlite_master` + `PRAGMA` walks. Type strings come back as the
 * column's *declared* affinity (`TEXT`, `INTEGER`, …) lowercased — SQLite
 * doesn't preserve the original DSL type (a `uuid()` column reads back as
 * `text`), so this is primarily for `kick db introspect` (reverse-engineer
 * a schema), not byte-exact drift against a code-first snapshot.
 */
export function introspectSqlite(
  db: SqliteIntrospectDb,
  opts: IntrospectSqliteOptions = {},
): SchemaSnapshot {
  const excluded = opts.excludeTables ?? DEFAULT_EXCLUDED

  const tableRows = db
    .prepare(
      `SELECT name FROM sqlite_master
       WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
       ORDER BY name`,
    )
    .all<{ name: string }>()

  const tables: Record<string, TableSnapshot> = {}
  for (const { name } of tableRows) {
    if (excluded.includes(name)) continue
    tables[name] = {
      name,
      columns: readColumns(db, name),
      indexes: readIndexes(db, name),
      foreignKeys: readForeignKeys(db, name),
      checks: [],
    }
  }
  return { version: 1, dialect: 'sqlite', tables }
}

function readColumns(db: SqliteIntrospectDb, table: string): Record<string, ColumnSnapshot> {
  const rows = db.prepare(`PRAGMA table_info(${quote(table)})`).all<TableInfoRow>()
  const out: Record<string, ColumnSnapshot> = {}
  for (const r of rows) {
    out[r.name] = {
      name: r.name,
      type: normalizeType(r.type),
      nullable: r.notnull === 0,
      default: r.dflt_value,
      primaryKey: r.pk > 0,
    }
  }
  return out
}

function readIndexes(db: SqliteIntrospectDb, table: string): IndexSnapshot[] {
  const list = db.prepare(`PRAGMA index_list(${quote(table)})`).all<IndexListRow>()
  const out: IndexSnapshot[] = []
  for (const idx of list) {
    // Skip auto-indexes SQLite creates for UNIQUE / PK constraints — those
    // belong to the column/constraint definitions, not standalone indexes.
    if (idx.origin !== 'c') continue
    const cols = db
      .prepare(`PRAGMA index_info(${quote(idx.name)})`)
      .all<IndexInfoRow>()
      .filter((c) => c.name !== null)
      .map((c) => c.name as string)
    out.push({ name: idx.name, columns: cols, unique: idx.unique === 1 })
  }
  return out
}

function readForeignKeys(db: SqliteIntrospectDb, table: string): ForeignKeySnapshot[] {
  const rows = db.prepare(`PRAGMA foreign_key_list(${quote(table)})`).all<FkListRow>()
  // Group multi-column FKs by their `id`.
  const byId = new Map<number, FkListRow[]>()
  for (const r of rows) {
    const g = byId.get(r.id) ?? []
    g.push(r)
    byId.set(r.id, g)
  }
  const out: ForeignKeySnapshot[] = []
  for (const [id, group] of byId) {
    group.sort((a, b) => a.seq - b.seq)
    const first = group[0]
    out.push({
      // SQLite doesn't name FKs — synthesize a stable name.
      name: `${table}_${group.map((g) => g.from).join('_')}_fk_${id}`,
      columns: group.map((g) => g.from),
      refTable: first.table,
      refColumns: group.map((g) => g.to),
      onDelete: mapFkAction(first.on_delete),
      onUpdate: mapFkAction(first.on_update),
    })
  }
  return out
}

function mapFkAction(action: string): FkAction {
  switch (action.toUpperCase()) {
    case 'CASCADE':
      return 'cascade'
    case 'RESTRICT':
      return 'restrict'
    case 'SET NULL':
      return 'set_null'
    case 'SET DEFAULT':
      return 'set_default'
    default:
      return 'no_action'
  }
}

/** Lowercase the declared type, preserving any `(length)` qualifier. */
function normalizeType(declared: string): string {
  return declared.trim().toLowerCase() || 'text'
}

/** Quote a SQLite identifier for interpolation into a PRAGMA (no binding). */
function quote(name: string): string {
  return '"' + name.replace(/"/g, '""') + '"'
}
