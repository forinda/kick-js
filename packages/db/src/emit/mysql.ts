import type { Change, ChangeSet } from '../diff/types'
import type {
  ColumnSnapshot,
  ForeignKeySnapshot,
  IndexSnapshot,
  TableSnapshot,
} from '../snapshot/types'
import { quoteLiteral } from './identifiers'

/** MySQL quotes identifiers with backticks, not double quotes. */
function ident(name: string): string {
  return name
    .split('.')
    .map((part) => '`' + part.replace(/`/g, '``') + '`')
    .join('.')
}

/**
 * Emit MySQL DDL for a change set.
 *
 * MySQL has full `ALTER TABLE` support (unlike SQLite), so this mirrors
 * the Postgres emitter's structure — column/FK/index changes map to direct
 * ALTERs. The MySQL-specific bits:
 * - backtick identifiers + PG→MySQL type mapping;
 * - a single integer PK is emitted inline as `... AUTO_INCREMENT PRIMARY
 *   KEY` (MySQL requires an auto-increment column to be a key);
 * - `alterColumn` uses `MODIFY COLUMN` (MySQL restates the whole column
 *   definition at once, rather than PG's separate SET TYPE / SET DEFAULT
 *   / SET NOT NULL clauses);
 * - `dropForeignKey` uses `DROP FOREIGN KEY` (not `DROP CONSTRAINT`).
 * - PG `ENUM` type changes are PG-only and throw (MySQL enums are inline
 *   column types, not standalone objects).
 */
export function emitMysql(changes: ChangeSet): string {
  return changes
    .map(emitChange)
    .filter((s) => s.length > 0)
    .join('\n')
}

function emitChange(change: Change): string {
  switch (change.kind) {
    case 'createTable':
      return emitCreateTable(change.table)
    case 'dropTable':
      return `DROP TABLE ${ident(change.table.name)};`
    case 'renameTable':
      return `ALTER TABLE ${ident(change.from)} RENAME TO ${ident(change.to)};`
    case 'addColumn':
      return `ALTER TABLE ${ident(change.table)} ADD COLUMN ${emitColumnDecl(change.column)};`
    case 'dropColumn':
      return `ALTER TABLE ${ident(change.table)} DROP COLUMN ${ident(change.column.name)};`
    case 'renameColumn':
      // MySQL 8.0+ supports RENAME COLUMN.
      return `ALTER TABLE ${ident(change.table)} RENAME COLUMN ${ident(change.from)} TO ${ident(change.to)};`
    case 'alterColumn':
      // MySQL restates the full column definition in one MODIFY clause.
      return `ALTER TABLE ${ident(change.table)} MODIFY COLUMN ${emitColumnDecl(change.after)};`
    case 'addIndex':
      return emitAddIndex(change.table, change.index)
    case 'dropIndex':
      return `DROP INDEX ${ident(change.index.name)} ON ${ident(change.table)};`
    case 'addForeignKey':
      return emitAddFk(change.table, change.fk)
    case 'dropForeignKey':
      return `ALTER TABLE ${ident(change.table)} DROP FOREIGN KEY ${ident(change.fk.name)};`
    case 'createEnum':
    case 'dropEnum':
    case 'addEnumValue':
    case 'removeEnumValue':
      throw new Error(
        `kickjs-db: standalone ENUM type changes are PostgreSQL-only and can't be ` +
          `emitted for MySQL. Model the column as an inline MySQL ENUM(...) or a ` +
          `CHECK constraint instead.`,
      )
  }
}

function emitCreateTable(t: TableSnapshot): string {
  const columns = Object.values(t.columns)
  const pkCols = columns.filter((c) => c.primaryKey)

  // A single integer PK is emitted inline with AUTO_INCREMENT (when the
  // column is serial) — MySQL requires an auto-increment column to be the
  // key, declared on the column itself.
  const inlinePk = pkCols.length === 1 && /serial/i.test(pkCols[0].type) ? pkCols[0] : null

  const lines = columns.map((c) => emitColumnDecl(c, c === inlinePk))
  if (!inlinePk && pkCols.length > 0) {
    lines.push(`PRIMARY KEY (${pkCols.map((c) => ident(c.name)).join(', ')})`)
  }
  return `CREATE TABLE ${ident(t.name)} (\n  ${lines.join(',\n  ')}\n);`
}

function emitColumnDecl(c: ColumnSnapshot, inlinePk = false): string {
  let s = `${ident(c.name)} ${mysqlType(c.type)}`
  if (!c.nullable) s += ' NOT NULL'
  if (c.default !== null) s += ` DEFAULT ${mysqlDefault(c.default)}`
  if (inlinePk) s += ' AUTO_INCREMENT PRIMARY KEY'
  return s
}

function emitAddIndex(table: string, i: IndexSnapshot): string {
  const cols = i.columns.map(ident).join(', ')
  return `CREATE${i.unique ? ' UNIQUE' : ''} INDEX ${ident(i.name)} ON ${ident(table)} (${cols});`
}

const FK_ACTIONS: Record<string, string> = {
  cascade: 'CASCADE',
  restrict: 'RESTRICT',
  set_null: 'SET NULL',
  set_default: 'SET DEFAULT',
  no_action: 'NO ACTION',
}

function emitAddFk(table: string, fk: ForeignKeySnapshot): string {
  const cols = fk.columns.map(ident).join(', ')
  const refCols = fk.refColumns.map(ident).join(', ')
  return (
    `ALTER TABLE ${ident(table)} ADD CONSTRAINT ${ident(fk.name)} ` +
    `FOREIGN KEY (${cols}) REFERENCES ${ident(fk.refTable)} (${refCols}) ` +
    `ON DELETE ${FK_ACTIONS[fk.onDelete]} ON UPDATE ${FK_ACTIONS[fk.onUpdate]};`
  )
}

/**
 * Map a Postgres column type string to a MySQL type.
 */
function mysqlType(pgType: string): string {
  const lower = pgType.toLowerCase().trim()
  const base = lower
    .replace(/\(.*\)/, '')
    .replace(/\[\]$/, '')
    .trim()
  // Preserve an explicit length/precision, e.g. varchar(200) → VARCHAR(200).
  const lenMatch = lower.match(/\(([^)]*)\)/)
  const len = lenMatch ? `(${lenMatch[1]})` : ''

  if (base === 'serial' || base === 'integer' || base === 'int' || base === 'int4') return 'INT'
  if (base === 'bigserial' || base === 'bigint' || base === 'int8') return 'BIGINT'
  if (base === 'smallserial' || base === 'smallint' || base === 'int2') return 'SMALLINT'
  if (base === 'boolean' || base === 'bool') return 'TINYINT(1)'
  if (base === 'real' || base === 'float4') return 'FLOAT'
  if (base === 'double precision' || base === 'float8' || base === 'float') return 'DOUBLE'
  if (base === 'numeric' || base === 'decimal') return `DECIMAL${len || '(10,0)'}`
  if (base === 'money') return 'DECIMAL(19,4)'
  if (base === 'uuid') return 'CHAR(36)'
  if (base === 'varchar' || base === 'character varying') return `VARCHAR${len || '(255)'}`
  if (base === 'char' || base === 'character' || base === 'bpchar') return `CHAR${len || '(1)'}`
  if (base === 'text' || base === 'citext') return 'TEXT'
  if (base === 'json' || base === 'jsonb') return 'JSON'
  if (base === 'timestamp' || base === 'timestamptz') return 'TIMESTAMP'
  if (base === 'date') return 'DATE'
  if (base === 'time' || base === 'timetz') return 'TIME'
  if (base === 'bytea' || base === 'blob') return 'BLOB'
  // Pass anything else through uppercased with its length (best effort).
  return base.toUpperCase() + len
}

/**
 * Map a Postgres default expression to its MySQL equivalent.
 */
function mysqlDefault(value: unknown): string {
  if (typeof value === 'boolean') return value ? '1' : '0'
  if (typeof value === 'number' || typeof value === 'bigint') return String(value)
  const str = String(value).trim()

  if (/^true$/i.test(str)) return '1'
  if (/^false$/i.test(str)) return '0'

  // Postgres UUID/`now()` generators → MySQL equivalents.
  if (/^(gen_random_uuid|uuid_generate_v4)\(\)$/i.test(str)) return '(UUID())'
  if (/^now\(\)$/i.test(str)) return 'CURRENT_TIMESTAMP'
  if (/^(CURRENT_TIMESTAMP|CURRENT_DATE|CURRENT_TIME|NULL)$/i.test(str)) return str.toUpperCase()
  if (/^-?\d+(\.\d+)?$/.test(str)) return str

  // Other bare function calls pass through; everything else is a literal.
  if (/^[a-z_][a-z0-9_]*\s*\([^)]*\)$/i.test(str)) return str
  return quoteLiteral(str)
}
