import type { Change, ChangeSet } from '../diff/types'
import type {
  ColumnSnapshot,
  ForeignKeySnapshot,
  IndexSnapshot,
  SchemaSnapshot,
  TableSnapshot,
} from '../snapshot/types'
import { quoteIdent, quoteLiteral } from './identifiers'

/**
 * Raised when a change set needs a SQLite table rebuild but the emitter
 * wasn't given the resolved snapshots to build it from (it only has the
 * per-change diff). `generate()` always passes the snapshots, so this only
 * surfaces if `emitSqlite` is called bare with a rebuild-requiring change.
 */
export class SqliteRebuildRequiredError extends Error {
  constructor(detail: string) {
    super(
      `kickjs-db: this SQLite change needs a table rebuild and no resolved ` +
        `schema snapshot was supplied to build it — ${detail}. This is an ` +
        `internal error; report it (generate() passes the snapshots).`,
    )
    this.name = 'SqliteRebuildRequiredError'
  }
}

/**
 * Resolved before/after schema snapshots, threaded in by `generate()` so
 * the emitter can build the 12-step table-rebuild for changes SQLite's
 * `ALTER TABLE` can't express (column type/null/default changes, FK
 * add/drop on an existing table). `to` is the schema *after* the changes
 * apply; `from` is before — their column intersection drives the
 * `INSERT ... SELECT` data copy.
 */
export interface SqliteEmitContext {
  from?: SchemaSnapshot
  to?: SchemaSnapshot
}

/**
 * Emit SQLite DDL for a change set.
 *
 * Most operations map to a direct statement (CREATE/DROP/RENAME TABLE,
 * ADD/DROP/RENAME COLUMN, CREATE/DROP INDEX). The ones SQLite can't `ALTER`
 * directly — `alterColumn`, and foreign-key add/drop on an existing table —
 * are handled by a **table rebuild**: create a new table with the desired
 * shape, copy rows, drop the old, rename, recreate indexes. Foreign keys
 * are folded into `CREATE TABLE` (SQLite has no `ADD CONSTRAINT`).
 */
export function emitSqlite(changes: ChangeSet, ctx: SqliteEmitContext = {}): string {
  const createdTables = new Set<string>()
  for (const c of changes) if (c.kind === 'createTable') createdTables.add(c.table.name)

  // Tables that need a rebuild (an ALTER SQLite can't express). A table
  // created in this same change set is never rebuilt — its FKs inline into
  // CREATE TABLE directly.
  const rebuildTables = new Set<string>()
  for (const c of changes) {
    const t = perTableName(c)
    if (!t || createdTables.has(t)) continue
    if (c.kind === 'alterColumn' || c.kind === 'dropForeignKey' || c.kind === 'addForeignKey') {
      rebuildTables.add(t)
    }
  }

  const out: string[] = []

  // 1. Emit every change that isn't subsumed by a rebuild.
  for (const c of changes) {
    const t = perTableName(c)
    if (t && rebuildTables.has(t)) continue // folded into the rebuild below
    const sql = emitChange(c)
    if (sql) out.push(sql)
  }

  // 2. Emit one rebuild per affected table, from the resolved `to` snapshot.
  for (const table of rebuildTables) {
    out.push(emitRebuild(table, ctx))
  }

  return out.join('\n')
}

/** The table a per-table change targets, or null for table-level changes. */
function perTableName(change: Change): string | null {
  switch (change.kind) {
    case 'addColumn':
    case 'dropColumn':
    case 'renameColumn':
    case 'alterColumn':
    case 'addIndex':
    case 'dropIndex':
    case 'addForeignKey':
    case 'dropForeignKey':
      return change.table
    default:
      return null
  }
}

function emitChange(change: Change): string {
  switch (change.kind) {
    case 'createTable':
      return emitCreateTable(change.table.name, change.table)
    case 'dropTable':
      return `DROP TABLE ${quoteIdent(change.table.name)};`
    case 'renameTable':
      return `ALTER TABLE ${quoteIdent(change.from)} RENAME TO ${quoteIdent(change.to)};`
    case 'addColumn':
      return `ALTER TABLE ${quoteIdent(change.table)} ADD COLUMN ${emitColumnDecl(change.column)};`
    case 'dropColumn':
      return `ALTER TABLE ${quoteIdent(change.table)} DROP COLUMN ${quoteIdent(change.column.name)};`
    case 'renameColumn':
      return `ALTER TABLE ${quoteIdent(change.table)} RENAME COLUMN ${quoteIdent(change.from)} TO ${quoteIdent(change.to)};`
    case 'addIndex':
      return emitAddIndex(change.table, change.index)
    case 'dropIndex':
      return `DROP INDEX ${quoteIdent(change.index.name)};`
    case 'addForeignKey':
    case 'dropForeignKey':
    case 'alterColumn':
      // FK add/drop + column alters never emit a standalone statement:
      // new-table FKs inline into CREATE TABLE, existing-table FK + column
      // changes are subsumed by the table rebuild.
      return ''
    case 'createEnum':
    case 'dropEnum':
    case 'addEnumValue':
    case 'removeEnumValue':
      throw new Error(
        `kickjs-db: enum changes are PostgreSQL-only and can't be emitted for SQLite. ` +
          `Model the constrained set with a CHECK constraint or a lookup table instead.`,
      )
  }
}

/**
 * The SQLite-recommended safe table mutation: create the new table, copy
 * the rows that survive (column intersection of old + new), drop the old,
 * rename, and recreate indexes.
 *
 * Works for tables without inbound foreign-key references (the common
 * case for a column type/default change). Tables referenced by other
 * tables' FKs would need `PRAGMA foreign_keys=OFF` outside the migration
 * transaction — out of scope here.
 */
function emitRebuild(table: string, ctx: SqliteEmitContext): string {
  const next = ctx.to?.tables[table]
  if (!next) {
    throw new SqliteRebuildRequiredError(`no resolved snapshot for table '${table}'`)
  }
  const prev = ctx.from?.tables[table]

  // Copy columns present in BOTH old and new (added columns get their
  // default; dropped columns are simply not selected).
  const newCols = Object.keys(next.columns)
  const common = prev ? newCols.filter((c) => c in prev.columns) : newCols
  const colList = common.map(quoteIdent).join(', ')

  const tmp = `_kick_new_${table}`
  const lines: string[] = [
    emitCreateTable(tmp, next),
    common.length > 0
      ? `INSERT INTO ${quoteIdent(tmp)} (${colList})\n  SELECT ${colList} FROM ${quoteIdent(table)};`
      : `-- (no columns survive the rebuild; nothing to copy)`,
    `DROP TABLE ${quoteIdent(table)};`,
    `ALTER TABLE ${quoteIdent(tmp)} RENAME TO ${quoteIdent(table)};`,
  ]
  for (const idx of next.indexes) lines.push(emitAddIndex(table, idx))
  return lines.join('\n')
}

function emitCreateTable(name: string, t: TableSnapshot): string {
  const columns = Object.values(t.columns)
  const pkCols = columns.filter((c) => c.primaryKey)

  // A single integer PK becomes the rowid alias only when declared inline
  // as `INTEGER PRIMARY KEY`; composite/non-integer PKs use a table clause.
  const inlinePk =
    pkCols.length === 1 && sqliteType(pkCols[0].type) === 'INTEGER' ? pkCols[0] : null

  const lines = columns.map((c) => emitColumnDecl(c, c === inlinePk))
  if (!inlinePk && pkCols.length > 0) {
    lines.push(`PRIMARY KEY (${pkCols.map((c) => quoteIdent(c.name)).join(', ')})`)
  }
  for (const fk of t.foreignKeys) lines.push(emitInlineFk(fk))

  return `CREATE TABLE ${quoteIdent(name)} (\n  ${lines.join(',\n  ')}\n);`
}

function emitColumnDecl(c: ColumnSnapshot, inlinePk = false): string {
  let s = `${quoteIdent(c.name)} ${sqliteType(c.type)}`
  if (inlinePk) {
    s += ' PRIMARY KEY'
    if (/serial/i.test(c.type)) s += ' AUTOINCREMENT'
  }
  if (!c.nullable && !inlinePk) s += ' NOT NULL'
  if (c.default !== null) s += ` DEFAULT ${sqliteDefault(c.default)}`
  return s
}

function emitAddIndex(table: string, i: IndexSnapshot): string {
  const cols = i.columns.map(quoteIdent).join(', ')
  return `CREATE${i.unique ? ' UNIQUE' : ''} INDEX ${quoteIdent(i.name)} ON ${quoteIdent(table)} (${cols});`
}

const FK_ACTIONS: Record<string, string> = {
  cascade: 'CASCADE',
  restrict: 'RESTRICT',
  set_null: 'SET NULL',
  set_default: 'SET DEFAULT',
  no_action: 'NO ACTION',
}

function emitInlineFk(fk: ForeignKeySnapshot): string {
  const cols = fk.columns.map(quoteIdent).join(', ')
  const refCols = fk.refColumns.map(quoteIdent).join(', ')
  return (
    `FOREIGN KEY (${cols}) REFERENCES ${quoteIdent(fk.refTable)} (${refCols}) ` +
    `ON DELETE ${FK_ACTIONS[fk.onDelete]} ON UPDATE ${FK_ACTIONS[fk.onUpdate]}`
  )
}

/** Map a Postgres column type string to a SQLite affinity type. */
export function sqliteType(pgType: string): string {
  const base = pgType
    .toLowerCase()
    .replace(/\(.*\)/, '')
    .replace(/\[\]$/, '')
    .trim()

  if (/^(serial|bigserial|smallserial|big|small)?int(eger|2|4|8)?$/.test(base)) return 'INTEGER'
  if (base === 'serial' || base === 'bigserial' || base === 'smallserial') return 'INTEGER'
  if (base === 'boolean' || base === 'bool') return 'INTEGER'
  if (/^(real|float4|float8|double precision|float)$/.test(base)) return 'REAL'
  if (/^(numeric|decimal|money)$/.test(base)) return 'NUMERIC'
  if (base === 'bytea' || base === 'blob') return 'BLOB'
  return 'TEXT'
}

/** Map a Postgres default expression to its SQLite equivalent. */
function sqliteDefault(value: unknown): string {
  if (typeof value === 'boolean') return value ? '1' : '0'
  if (typeof value === 'number' || typeof value === 'bigint') return String(value)
  const str = String(value).trim()

  if (/^true$/i.test(str)) return '1'
  if (/^false$/i.test(str)) return '0'
  if (/^(gen_random_uuid|uuid_generate_v4)\(\)$/i.test(str)) return '(lower(hex(randomblob(16))))'
  if (/^now\(\)$/i.test(str)) return 'CURRENT_TIMESTAMP'
  if (/^(CURRENT_TIMESTAMP|CURRENT_DATE|CURRENT_TIME|NULL)$/i.test(str)) return str.toUpperCase()
  if (/^-?\d+(\.\d+)?$/.test(str)) return str
  if (/^[a-z_][a-z0-9_]*\s*\([^)]*\)$/i.test(str)) return str
  return quoteLiteral(str)
}
