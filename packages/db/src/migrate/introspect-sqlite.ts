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

/** One query introspection needs: the caller runs it and sends back the rows. */
type Step = { sql: string; params: unknown[] }
type Steps<T> = Generator<Step, T, unknown[]>

/** Run a query; the rows come back from whoever drives the walk. */
function* rows<T>(sql: string, ...params: unknown[]): Steps<T[]> {
  return (yield { sql, params }) as T[]
}

/**
 * The introspection walk, written once: it yields each query it needs, so the
 * same code runs over a sync handle (better-sqlite3, `bun:sqlite`) and an
 * async driver (libsql, D1). Counts are read with `Number()` because some
 * drivers return them as bigints.
 */
function* introspectSteps(opts: IntrospectSqliteOptions): Steps<SchemaSnapshot> {
  const excluded = opts.excludeTables ?? DEFAULT_EXCLUDED
  // `_cf_*` tables are Cloudflare D1's own.
  const tableRows = yield* rows<{ name: string }>(
    `SELECT name FROM sqlite_master
       WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '\\_cf\\_%' ESCAPE '\\'
       ORDER BY name`,
  )

  const tables: Record<string, TableSnapshot> = {}
  for (const { name } of tableRows) {
    if (excluded.includes(name)) continue
    tables[name] = {
      name,
      columns: yield* readColumns(name),
      indexes: yield* readIndexes(name),
      foreignKeys: yield* readForeignKeys(name),
      checks: [],
    }
  }
  return { version: 1, dialect: 'sqlite', tables }
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
  const walk = introspectSteps(opts)
  let step = walk.next()
  while (!step.done) step = walk.next(db.prepare(step.value.sql).all(...step.value.params))
  return step.value
}

/**
 * {@link introspectSqlite} over an async driver (libsql/Turso, Cloudflare D1):
 * `query` runs one statement and resolves with its rows.
 */
export async function introspectSqliteAsync(
  query: (sql: string, params: unknown[]) => Promise<unknown[]>,
  opts: IntrospectSqliteOptions = {},
): Promise<SchemaSnapshot> {
  const walk = introspectSteps(opts)
  let step = walk.next()
  while (!step.done) step = walk.next(await query(step.value.sql, step.value.params))
  return step.value
}

function* readColumns(table: string): Steps<Record<string, ColumnSnapshot>> {
  // table_xinfo, unlike table_info, lists generated columns too.
  const list = yield* rows<TableInfoRow>(`PRAGMA table_xinfo(${quote(table)})`)
  const out: Record<string, ColumnSnapshot> = {}
  let createSql: string | undefined
  for (const r of list) {
    out[r.name] = {
      name: r.name,
      // SQLite reports a generated column's type with the clause appended.
      type: normalizeType(r.type.replace(/\s+GENERATED\s+ALWAYS\b.*$/i, '')),
      nullable: Number(r.notnull) === 0,
      default: r.dflt_value,
      primaryKey: Number(r.pk) > 0,
    }
    const hidden = Number(r.hidden ?? 0)
    if (hidden === 2 || hidden === 3) {
      createSql ??= (yield* rows<{ sql: string }>(
        `SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?`,
        table,
      ))[0]?.sql
      out[r.name].generated = {
        expression: generatedExpression(createSql ?? '', r.name),
        stored: hidden === 3,
      }
    }
  }
  return out
}

function* readIndexes(table: string): Steps<IndexSnapshot[]> {
  const list = yield* rows<IndexListRow>(`PRAGMA index_list(${quote(table)})`)
  const out: IndexSnapshot[] = []
  for (const idx of list) {
    // Skip auto-indexes SQLite creates for UNIQUE / PK constraints — those
    // belong to the column/constraint definitions, not standalone indexes.
    if (idx.origin !== 'c') continue
    const cols = (yield* rows<IndexInfoRow>(`PRAGMA index_info(${quote(idx.name)})`))
      .filter((c) => c.name !== null)
      .map((c) => c.name as string)
    const entry: IndexSnapshot = { name: idx.name, columns: cols, unique: Number(idx.unique) === 1 }
    if (Number(idx.partial) === 1) {
      // SQLite keeps only the statement; WHERE is its last clause.
      const row = (yield* rows<{ sql: string | null }>(
        `SELECT sql FROM sqlite_master WHERE type = 'index' AND name = ?`,
        idx.name,
      ))[0]
      const where = row?.sql?.match(/\bWHERE\b([\s\S]*)$/i)?.[1].trim()
      if (where) entry.where = where
    }
    out.push(entry)
  }
  return out
}

function* readForeignKeys(table: string): Steps<ForeignKeySnapshot[]> {
  const list = yield* rows<FkListRow>(`PRAGMA foreign_key_list(${quote(table)})`)
  // Group multi-column FKs by their `id`.
  const byId = new Map<number, FkListRow[]>()
  for (const r of list) {
    const g = byId.get(Number(r.id)) ?? []
    g.push(r)
    byId.set(Number(r.id), g)
  }
  const out: ForeignKeySnapshot[] = []
  for (const [id, group] of byId) {
    group.sort((a, b) => Number(a.seq) - Number(b.seq))
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
