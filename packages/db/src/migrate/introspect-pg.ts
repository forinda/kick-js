import type {
  ForeignKeySnapshot,
  FkAction,
  IndexSnapshot,
  SchemaSnapshot,
  TableSnapshot,
} from '../snapshot/types'
import type { IntrospectPgOptions, PgQueryRunner } from './introspect-types'

const DEFAULT_EXCLUDED = ['kick_migrations', 'kick_migrations_lock']

interface ColumnRow {
  column_name: string
  data_type: string
  udt_name: string
  is_nullable: 'YES' | 'NO'
  column_default: string | null
  character_maximum_length: number | null
  numeric_precision: number | null
  numeric_scale: number | null
}

interface IndexRow {
  index_name: string
  column_name: string
  is_unique: boolean
  is_primary: boolean
}

interface FkRow {
  constraint_name: string
  column_name: string
  ref_table: string
  ref_column: string
  delete_rule: string
  update_rule: string
}

export async function introspectPg(
  client: PgQueryRunner,
  opts: IntrospectPgOptions = {},
): Promise<SchemaSnapshot> {
  const schema = opts.schema ?? 'public'
  const excluded = opts.excludeTables ?? DEFAULT_EXCLUDED

  const tableRows = await client.query<{ table_name: string }>(
    `SELECT table_name
     FROM information_schema.tables
     WHERE table_schema = $1 AND table_type = 'BASE TABLE'
     ORDER BY table_name`,
    [schema],
  )

  const tables: Record<string, TableSnapshot> = {}
  for (const t of tableRows.rows) {
    if (excluded.includes(t.table_name)) continue
    tables[t.table_name] = {
      name: t.table_name,
      columns: await readColumns(client, schema, t.table_name),
      indexes: await readIndexes(client, schema, t.table_name),
      foreignKeys: await readForeignKeys(client, schema, t.table_name),
      checks: [],
    }
  }
  return { version: 1, dialect: 'postgres', tables }
}

async function readColumns(
  client: PgQueryRunner,
  schema: string,
  table: string,
): Promise<TableSnapshot['columns']> {
  const cols = await client.query<ColumnRow>(
    `SELECT column_name, data_type, udt_name, is_nullable, column_default,
            character_maximum_length, numeric_precision, numeric_scale
     FROM information_schema.columns
     WHERE table_schema = $1 AND table_name = $2
     ORDER BY ordinal_position`,
    [schema, table],
  )

  const pkCols = await client.query<{ column_name: string }>(
    `SELECT k.column_name
     FROM information_schema.table_constraints c
     JOIN information_schema.key_column_usage k
       ON k.constraint_name = c.constraint_name
      AND k.table_schema = c.table_schema
     WHERE c.table_schema = $1 AND c.table_name = $2 AND c.constraint_type = 'PRIMARY KEY'
     ORDER BY k.ordinal_position`,
    [schema, table],
  )
  const pkSet = new Set(pkCols.rows.map((r) => r.column_name))

  const out: TableSnapshot['columns'] = {}
  for (const r of cols.rows) {
    const isSerial = isSerialColumn(r)
    out[r.column_name] = {
      name: r.column_name,
      type: isSerial ? serialTypeFor(r) : normalizeType(r),
      nullable: r.is_nullable === 'YES',
      // serial columns own their nextval default; collapse it to keep round-
      // trips (DSL → emit → introspect) idempotent.
      default: isSerial ? null : normalizeDefault(r.column_default),
      primaryKey: pkSet.has(r.column_name),
    }
  }
  return out
}

function isSerialColumn(r: ColumnRow): boolean {
  if (!r.column_default) return false
  if (!r.column_default.startsWith('nextval(')) return false
  return r.udt_name === 'int2' || r.udt_name === 'int4' || r.udt_name === 'int8'
}

function serialTypeFor(r: ColumnRow): string {
  if (r.udt_name === 'int8') return 'bigserial'
  if (r.udt_name === 'int2') return 'smallserial'
  return 'serial'
}

function normalizeType(r: ColumnRow): string {
  // Map PG's information_schema data_type back to the DSL surface.
  if (r.data_type === 'character varying') {
    return r.character_maximum_length ? `varchar(${r.character_maximum_length})` : 'varchar'
  }
  if (r.data_type === 'character') {
    return r.character_maximum_length ? `char(${r.character_maximum_length})` : 'char(1)'
  }
  if (r.data_type === 'numeric') {
    if (r.numeric_precision !== null && r.numeric_scale !== null) {
      return `numeric(${r.numeric_precision}, ${r.numeric_scale})`
    }
    if (r.numeric_precision !== null) return `numeric(${r.numeric_precision})`
    return 'numeric'
  }
  if (r.data_type === 'timestamp with time zone') return 'timestamptz'
  if (r.data_type === 'timestamp without time zone') return 'timestamp'
  if (r.data_type === 'time without time zone') return 'time'
  if (r.data_type === 'double precision') return 'double precision'
  if (r.data_type === 'USER-DEFINED') return r.udt_name
  if (r.data_type === 'ARRAY') {
    // udt_name for arrays is _<element>; strip and append [].
    const elem = r.udt_name.replace(/^_/, '')
    return `${elem}[]`
  }
  // bigint, integer, smallint, text, boolean, date, json, jsonb, bytea, uuid,
  // interval, etc — pass through as data_type when it matches the DSL.
  return r.data_type
}

function normalizeDefault(raw: string | null): string | null {
  if (!raw) return null
  // Strip PG's :: cast suffixes: 'true'::boolean → true, 'foo'::text → 'foo'
  const stripped = raw.replace(/::[\w" ]+(\([^)]*\))?$/, '')
  // Normalize CURRENT_TIMESTAMP / now() to the DSL canonical token.
  const upper = stripped.toUpperCase()
  if (upper === 'NOW()' || upper === 'CURRENT_TIMESTAMP') return 'CURRENT_TIMESTAMP'
  if (upper === 'GEN_RANDOM_UUID()') return 'gen_random_uuid()'
  // 'foo' literal → foo. true / false / numeric pass through.
  return stripped.replace(/^'(.*)'$/, '$1')
}

async function readIndexes(
  client: PgQueryRunner,
  schema: string,
  table: string,
): Promise<IndexSnapshot[]> {
  const rows = await client.query<IndexRow>(
    `SELECT i.relname AS index_name,
            a.attname AS column_name,
            ix.indisunique AS is_unique,
            ix.indisprimary AS is_primary
     FROM pg_class t
     JOIN pg_namespace n ON n.oid = t.relnamespace
     JOIN pg_index ix ON ix.indrelid = t.oid
     JOIN pg_class i ON i.oid = ix.indexrelid
     JOIN unnest(ix.indkey) WITH ORDINALITY AS k(attnum, ord) ON true
     JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
     WHERE n.nspname = $1 AND t.relname = $2 AND t.relkind = 'r'
     ORDER BY i.relname, k.ord`,
    [schema, table],
  )

  // Group rows by index_name, preserve column order.
  type Tagged = IndexSnapshot & { _isPrimary: boolean }
  const byIndex = new Map<string, Tagged>()
  for (const r of rows.rows) {
    let entry = byIndex.get(r.index_name)
    if (!entry) {
      entry = {
        name: r.index_name,
        columns: [],
        unique: r.is_unique,
        _isPrimary: r.is_primary,
      }
      byIndex.set(r.index_name, entry)
    }
    entry.columns.push(r.column_name)
  }

  // Drop PK-backing indexes — primaryKey is recorded on the column itself.
  return [...byIndex.values()]
    .filter((i) => !i._isPrimary)
    .map(({ _isPrimary, ...rest }) => rest)
    .toSorted((a, b) => a.name.localeCompare(b.name))
}

async function readForeignKeys(
  client: PgQueryRunner,
  schema: string,
  table: string,
): Promise<ForeignKeySnapshot[]> {
  const rows = await client.query<FkRow>(
    `SELECT tc.constraint_name,
            kcu.column_name,
            ccu.table_name AS ref_table,
            ccu.column_name AS ref_column,
            rc.delete_rule,
            rc.update_rule
     FROM information_schema.table_constraints tc
     JOIN information_schema.key_column_usage kcu
       ON kcu.constraint_name = tc.constraint_name
      AND kcu.table_schema = tc.table_schema
     JOIN information_schema.referential_constraints rc
       ON rc.constraint_name = tc.constraint_name
      AND rc.constraint_schema = tc.table_schema
     JOIN information_schema.constraint_column_usage ccu
       ON ccu.constraint_name = rc.unique_constraint_name
      AND ccu.constraint_schema = rc.unique_constraint_schema
     WHERE tc.table_schema = $1
       AND tc.table_name = $2
       AND tc.constraint_type = 'FOREIGN KEY'
     ORDER BY tc.constraint_name, kcu.ordinal_position`,
    [schema, table],
  )

  const byName = new Map<string, ForeignKeySnapshot>()
  for (const r of rows.rows) {
    let fk = byName.get(r.constraint_name)
    if (!fk) {
      fk = {
        name: r.constraint_name,
        columns: [],
        refTable: r.ref_table,
        refColumns: [],
        onDelete: mapFkAction(r.delete_rule),
        onUpdate: mapFkAction(r.update_rule),
      }
      byName.set(r.constraint_name, fk)
    }
    fk.columns.push(r.column_name)
    fk.refColumns.push(r.ref_column)
  }
  return [...byName.values()].toSorted((a, b) => a.name.localeCompare(b.name))
}

function mapFkAction(raw: string): FkAction {
  switch (raw.toUpperCase()) {
    case 'CASCADE':
      return 'cascade'
    case 'RESTRICT':
      return 'restrict'
    case 'SET NULL':
      return 'set_null'
    case 'SET DEFAULT':
      return 'set_default'
    case 'NO ACTION':
    default:
      return 'no_action'
  }
}
