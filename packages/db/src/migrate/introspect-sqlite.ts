import type {
  ColumnSnapshot,
  ForeignKeySnapshot,
  FkAction,
  IndexSnapshot,
  SchemaSnapshot,
  TableSnapshot,
} from '../snapshot/types'

const DEFAULT_EXCLUDED = ['kick_migrations', 'kick_migrations_lock']

/**
 * Minimal better-sqlite3 surface introspection needs (sync `.all()`).
 *
 * `all` is deliberately NOT method-generic: better-sqlite3 v12's own
 * `Statement.all(...params): Result[]` is non-generic, so a generic
 * method here would make a real `Database` instance structurally
 * incompatible (callers had to cast). Row typing happens inside this
 * module via per-call assertions instead.
 */
export interface SqliteIntrospectDb {
  prepare(sql: string): { all(...params: unknown[]): unknown[] }
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
  /** table_xinfo: 2 a virtual generated column, 3 a stored one. */
  hidden?: number
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
    .all() as { name: string }[]

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
  // table_xinfo, unlike table_info, lists generated columns too.
  const rows = db.prepare(`PRAGMA table_xinfo(${quote(table)})`).all() as TableInfoRow[]
  const out: Record<string, ColumnSnapshot> = {}
  let createSql: string | undefined
  for (const r of rows) {
    out[r.name] = {
      name: r.name,
      // SQLite reports a generated column's type with the clause appended.
      type: normalizeType(r.type.replace(/\s+GENERATED\s+ALWAYS\b.*$/i, '')),
      nullable: r.notnull === 0,
      default: r.dflt_value,
      primaryKey: r.pk > 0,
    }
    if (r.hidden === 2 || r.hidden === 3) {
      createSql ??= (
        db
          .prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?`)
          .all(table)[0] as { sql: string } | undefined
      )?.sql
      out[r.name].generated = {
        expression: generatedExpression(createSql ?? '', r.name),
        stored: r.hidden === 3,
      }
    }
  }
  return out
}

function readIndexes(db: SqliteIntrospectDb, table: string): IndexSnapshot[] {
  const list = db.prepare(`PRAGMA index_list(${quote(table)})`).all() as IndexListRow[]
  const out: IndexSnapshot[] = []
  for (const idx of list) {
    // Skip auto-indexes SQLite creates for UNIQUE / PK constraints — those
    // belong to the column/constraint definitions, not standalone indexes.
    if (idx.origin !== 'c') continue
    const cols = (db.prepare(`PRAGMA index_info(${quote(idx.name)})`).all() as IndexInfoRow[])
      .filter((c) => c.name !== null)
      .map((c) => c.name as string)
    const entry: IndexSnapshot = { name: idx.name, columns: cols, unique: idx.unique === 1 }
    if (idx.partial === 1) {
      // SQLite keeps only the statement; WHERE is its last clause.
      const row = db
        .prepare(`SELECT sql FROM sqlite_master WHERE type = 'index' AND name = ?`)
        .all(idx.name)[0] as { sql: string | null } | undefined
      const where = row?.sql?.match(/\bWHERE\b([\s\S]*)$/i)?.[1].trim()
      if (where) entry.where = where
    }
    out.push(entry)
  }
  return out
}

function readForeignKeys(db: SqliteIntrospectDb, table: string): ForeignKeySnapshot[] {
  const rows = db.prepare(`PRAGMA foreign_key_list(${quote(table)})`).all() as FkListRow[]
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

/**
 * The expression of a generated column, read out of the table's CREATE
 * statement: the balanced parentheses after `GENERATED ALWAYS AS` in that
 * column's definition. Empty when it can't be found.
 */
function generatedExpression(createSql: string, column: string): string {
  const name = column.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const start = new RegExp(
    `["\`\\[]?${name}["\`\\]]?\\s[^,]*?GENERATED\\s+ALWAYS\\s+AS\\s*\\(`,
    'i',
  ).exec(createSql)
  if (!start) return ''
  let depth = 1
  const from = start.index + start[0].length
  for (let i = from; i < createSql.length; i++) {
    if (createSql[i] === '(') depth++
    else if (createSql[i] === ')' && --depth === 0) return createSql.slice(from, i).trim()
  }
  return ''
}
