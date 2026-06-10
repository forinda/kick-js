import type {
  ColumnSnapshot,
  ForeignKeySnapshot,
  FkAction,
  IndexSnapshot,
  SchemaSnapshot,
  TableSnapshot,
} from '../snapshot/types'

const DEFAULT_EXCLUDED = ['kick_migrations', 'kick_migrations_lock']

/** Minimal mysql2 surface introspection needs. Returns `[rows, fields]`. */
export interface MysqlIntrospectDb {
  query<R = unknown>(sql: string, params?: readonly unknown[]): Promise<[R, unknown]>
}

export interface IntrospectMysqlOptions {
  excludeTables?: string[]
}

interface ColumnRow {
  COLUMN_NAME: string
  DATA_TYPE: string
  COLUMN_TYPE: string
  IS_NULLABLE: 'YES' | 'NO'
  COLUMN_DEFAULT: string | null
  COLUMN_KEY: string
  EXTRA: string
}

interface IndexRow {
  INDEX_NAME: string
  COLUMN_NAME: string
  NON_UNIQUE: number
  SEQ_IN_INDEX: number
}

interface FkRow {
  CONSTRAINT_NAME: string
  COLUMN_NAME: string
  REF_TABLE: string
  REF_COLUMN: string
  DELETE_RULE: string
  UPDATE_RULE: string
  ORDINAL_POSITION: number
}

async function rows<R>(db: MysqlIntrospectDb, sql: string, params: unknown[]): Promise<R[]> {
  const [result] = await db.query<R[]>(sql, params)
  return result
}

/**
 * Read the current MySQL database into a {@link SchemaSnapshot} via
 * `information_schema`. Types come back as the column's declared
 * `COLUMN_TYPE` (`varchar(200)`, `tinyint(1)`, …) lowercased — MySQL
 * doesn't preserve the original DSL type, so this powers `kick db
 * introspect` rather than byte-exact drift against a code-first snapshot.
 */
export async function introspectMysql(
  db: MysqlIntrospectDb,
  opts: IntrospectMysqlOptions = {},
): Promise<SchemaSnapshot> {
  const excluded = opts.excludeTables ?? DEFAULT_EXCLUDED

  const tableRows = await rows<{ TABLE_NAME: string }>(
    db,
    `SELECT TABLE_NAME FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'
     ORDER BY TABLE_NAME`,
    [],
  )

  const tables: Record<string, TableSnapshot> = {}
  for (const t of tableRows) {
    if (excluded.includes(t.TABLE_NAME)) continue
    tables[t.TABLE_NAME] = {
      name: t.TABLE_NAME,
      columns: await readColumns(db, t.TABLE_NAME),
      indexes: await readIndexes(db, t.TABLE_NAME),
      foreignKeys: await readForeignKeys(db, t.TABLE_NAME),
      checks: [],
    }
  }
  return { version: 1, dialect: 'mysql', tables }
}

async function readColumns(
  db: MysqlIntrospectDb,
  table: string,
): Promise<Record<string, ColumnSnapshot>> {
  const cols = await rows<ColumnRow>(
    db,
    `SELECT COLUMN_NAME, DATA_TYPE, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, COLUMN_KEY, EXTRA
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
     ORDER BY ORDINAL_POSITION`,
    [table],
  )
  const out: Record<string, ColumnSnapshot> = {}
  for (const c of cols) {
    out[c.COLUMN_NAME] = {
      name: c.COLUMN_NAME,
      type: normalizeType(c),
      nullable: c.IS_NULLABLE === 'YES',
      default: c.COLUMN_DEFAULT,
      primaryKey: c.COLUMN_KEY === 'PRI',
    }
  }
  return out
}

async function readIndexes(db: MysqlIntrospectDb, table: string): Promise<IndexSnapshot[]> {
  const stats = await rows<IndexRow>(
    db,
    `SELECT INDEX_NAME, COLUMN_NAME, NON_UNIQUE, SEQ_IN_INDEX
     FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME <> 'PRIMARY'
     ORDER BY INDEX_NAME, SEQ_IN_INDEX`,
    [table],
  )
  const byName = new Map<string, { cols: string[]; unique: boolean }>()
  for (const r of stats) {
    const e = byName.get(r.INDEX_NAME) ?? { cols: [], unique: r.NON_UNIQUE === 0 }
    e.cols.push(r.COLUMN_NAME)
    byName.set(r.INDEX_NAME, e)
  }
  return [...byName].map(([name, e]) => ({ name, columns: e.cols, unique: e.unique }))
}

async function readForeignKeys(
  db: MysqlIntrospectDb,
  table: string,
): Promise<ForeignKeySnapshot[]> {
  const fkRows = await rows<FkRow>(
    db,
    `SELECT k.CONSTRAINT_NAME, k.COLUMN_NAME,
            k.REFERENCED_TABLE_NAME AS REF_TABLE, k.REFERENCED_COLUMN_NAME AS REF_COLUMN,
            r.DELETE_RULE, r.UPDATE_RULE, k.ORDINAL_POSITION
     FROM information_schema.KEY_COLUMN_USAGE k
     JOIN information_schema.REFERENTIAL_CONSTRAINTS r
       ON r.CONSTRAINT_SCHEMA = k.TABLE_SCHEMA AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME
     WHERE k.TABLE_SCHEMA = DATABASE() AND k.TABLE_NAME = ?
       AND k.REFERENCED_TABLE_NAME IS NOT NULL
     ORDER BY k.CONSTRAINT_NAME, k.ORDINAL_POSITION`,
    [table],
  )
  const byName = new Map<string, FkRow[]>()
  for (const r of fkRows) {
    const g = byName.get(r.CONSTRAINT_NAME) ?? []
    g.push(r)
    byName.set(r.CONSTRAINT_NAME, g)
  }
  const out: ForeignKeySnapshot[] = []
  for (const [name, group] of byName) {
    const first = group[0]
    out.push({
      name,
      columns: group.map((g) => g.COLUMN_NAME),
      refTable: first.REF_TABLE,
      refColumns: group.map((g) => g.REF_COLUMN),
      onDelete: mapFkAction(first.DELETE_RULE),
      onUpdate: mapFkAction(first.UPDATE_RULE),
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

/** Use the declared `COLUMN_TYPE` (carries length), lowercased. */
function normalizeType(c: ColumnRow): string {
  return (c.COLUMN_TYPE || c.DATA_TYPE).trim().toLowerCase() || 'text'
}
