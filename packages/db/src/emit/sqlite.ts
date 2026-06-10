import type { Change, ChangeSet } from '../diff/types'
import type {
  ColumnSnapshot,
  ForeignKeySnapshot,
  IndexSnapshot,
  TableSnapshot,
} from '../snapshot/types'
import { quoteIdent, quoteLiteral } from './identifiers'

/**
 * Raised when a change set contains a SQLite operation that SQLite's
 * limited `ALTER TABLE` can't express directly (altering a column's
 * type/null/default, or adding/dropping a foreign key on an existing
 * table). Those need the 12-step table-rebuild dance, not yet emitted —
 * author the migration by hand with `kick db generate --empty` for now.
 */
export class SqliteRebuildRequiredError extends Error {
  constructor(detail: string) {
    super(
      `kickjs-db: this change needs a SQLite table rebuild, which the emitter ` +
        `doesn't generate yet — ${detail}. Author it manually with ` +
        `\`kick db generate --empty <name>\` (CREATE new table → copy rows → ` +
        `DROP old → RENAME), or target PostgreSQL for automatic ALTERs.`,
    )
    this.name = 'SqliteRebuildRequiredError'
  }
}

/**
 * Emit SQLite DDL for a change set.
 *
 * SQLite-specific handling vs the Postgres emitter:
 * - PG column types are mapped to SQLite type affinities.
 * - A single integer primary key is emitted **inline** (`INTEGER
 *   PRIMARY KEY`) so it aliases the rowid (auto-increment); composite
 *   or non-integer PKs use a table-level `PRIMARY KEY (...)` clause.
 * - Foreign keys are **inlined into `CREATE TABLE`** — SQLite has no
 *   `ALTER TABLE ... ADD CONSTRAINT`. The diff emits a new table's FKs
 *   as separate `addForeignKey` changes; we fold those into the create
 *   and skip them here.
 * - `alterColumn`, FK changes on an existing table, and enum changes
 *   throw {@link SqliteRebuildRequiredError} (or an enum error) rather
 *   than emit wrong SQL.
 */
export function emitSqlite(changes: ChangeSet): string {
  // Tables created in this change set — their FKs are inlined into the
  // CREATE TABLE, so the separate `addForeignKey` changes are no-ops.
  const createdTables = new Set<string>()
  for (const c of changes) if (c.kind === 'createTable') createdTables.add(c.table.name)

  return changes
    .map((c) => emitChange(c, createdTables))
    .filter((s) => s.length > 0)
    .join('\n')
}

function emitChange(change: Change, createdTables: Set<string>): string {
  switch (change.kind) {
    case 'createTable':
      return emitCreateTable(change.table)
    case 'dropTable':
      return `DROP TABLE ${quoteIdent(change.table.name)};`
    case 'renameTable':
      return `ALTER TABLE ${quoteIdent(change.from)} RENAME TO ${quoteIdent(change.to)};`
    case 'addColumn':
      return `ALTER TABLE ${quoteIdent(change.table)} ADD COLUMN ${emitColumnDecl(change.column)};`
    case 'dropColumn':
      // SQLite 3.35+ supports DROP COLUMN.
      return `ALTER TABLE ${quoteIdent(change.table)} DROP COLUMN ${quoteIdent(change.column.name)};`
    case 'renameColumn':
      // SQLite 3.25+ supports RENAME COLUMN.
      return `ALTER TABLE ${quoteIdent(change.table)} RENAME COLUMN ${quoteIdent(change.from)} TO ${quoteIdent(change.to)};`
    case 'addIndex':
      return emitAddIndex(change.table, change.index)
    case 'dropIndex':
      return `DROP INDEX ${quoteIdent(change.index.name)};`
    case 'addForeignKey':
      // Inlined into CREATE TABLE for new tables; otherwise impossible
      // without a rebuild.
      if (createdTables.has(change.table)) return ''
      throw new SqliteRebuildRequiredError(
        `adding foreign key '${change.fk.name}' to existing table '${change.table}'`,
      )
    case 'dropForeignKey':
      throw new SqliteRebuildRequiredError(
        `dropping foreign key '${change.fk.name}' from table '${change.table}'`,
      )
    case 'alterColumn':
      throw new SqliteRebuildRequiredError(
        `altering column '${change.column}' on table '${change.table}'`,
      )
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

function emitCreateTable(t: TableSnapshot): string {
  const columns = Object.values(t.columns)
  const pkCols = columns.filter((c) => c.primaryKey)

  // A single integer PK becomes the rowid alias only when declared
  // inline as `INTEGER PRIMARY KEY` — a table-level PRIMARY KEY clause
  // would not auto-increment. Composite or non-integer PKs use the
  // table-level clause.
  const inlinePk =
    pkCols.length === 1 && sqliteType(pkCols[0].type) === 'INTEGER' ? pkCols[0] : null

  const lines = columns.map((c) => emitColumnDecl(c, c === inlinePk))

  if (!inlinePk && pkCols.length > 0) {
    lines.push(`PRIMARY KEY (${pkCols.map((c) => quoteIdent(c.name)).join(', ')})`)
  }
  for (const fk of t.foreignKeys) lines.push(emitInlineFk(fk))

  return `CREATE TABLE ${quoteIdent(t.name)} (\n  ${lines.join(',\n  ')}\n);`
}

function emitColumnDecl(c: ColumnSnapshot, inlinePk = false): string {
  let s = `${quoteIdent(c.name)} ${sqliteType(c.type)}`
  if (inlinePk) {
    s += ' PRIMARY KEY'
    // `serial`/`bigserial` imply an auto-incrementing PK.
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

/**
 * Map a Postgres column type string to a SQLite type. SQLite uses
 * type affinity (only the substring matters), but we emit canonical
 * names — `INTEGER` / `REAL` / `NUMERIC` / `TEXT` / `BLOB` — so the
 * generated DDL reads clearly and the right affinity is selected.
 */
function sqliteType(pgType: string): string {
  const base = pgType
    .toLowerCase()
    .replace(/\(.*\)/, '') // drop length/precision, e.g. varchar(200)
    .replace(/\[\]$/, '') // drop array marker (stored as TEXT/JSON)
    .trim()

  if (/^(serial|bigserial|smallserial|big|small)?int(eger|2|4|8)?$/.test(base)) return 'INTEGER'
  if (base === 'serial' || base === 'bigserial' || base === 'smallserial') return 'INTEGER'
  if (base === 'boolean' || base === 'bool') return 'INTEGER'
  if (/^(real|float4|float8|double precision|float)$/.test(base)) return 'REAL'
  if (/^(numeric|decimal|money)$/.test(base)) return 'NUMERIC'
  if (base === 'bytea' || base === 'blob') return 'BLOB'
  // varchar/char/text/uuid/json/jsonb/citext/xml/inet/cidr/timestamp/date/
  // time/interval and anything else → TEXT (SQLite stores dates as TEXT).
  return 'TEXT'
}

/**
 * Map a Postgres default expression to its SQLite equivalent.
 */
function sqliteDefault(value: unknown): string {
  if (typeof value === 'boolean') return value ? '1' : '0'
  if (typeof value === 'number' || typeof value === 'bigint') return String(value)
  const str = String(value).trim()

  // Booleans → SQLite integer literals.
  if (/^true$/i.test(str)) return '1'
  if (/^false$/i.test(str)) return '0'

  // Postgres UUID/`now()` generators → SQLite equivalents.
  if (/^(gen_random_uuid|uuid_generate_v4)\(\)$/i.test(str)) {
    // 16 random bytes → 32 hex chars. Not dash-formatted, but unique +
    // collision-safe; wrap in parens so SQLite treats it as an expression.
    return '(lower(hex(randomblob(16))))'
  }
  if (/^now\(\)$/i.test(str)) return 'CURRENT_TIMESTAMP'

  // SQLite-supported time keywords + plain numerics pass through bare.
  if (/^(CURRENT_TIMESTAMP|CURRENT_DATE|CURRENT_TIME|NULL)$/i.test(str)) return str.toUpperCase()
  if (/^-?\d+(\.\d+)?$/.test(str)) return str

  // Any other bare function call (best effort) passes through; everything
  // else is a string literal.
  if (/^[a-z_][a-z0-9_]*\s*\([^)]*\)$/i.test(str)) return str
  return quoteLiteral(str)
}
