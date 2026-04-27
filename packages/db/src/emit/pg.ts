import type { Change, ChangeSet } from '../diff/types'
import type { ColumnSnapshot, TableSnapshot } from '../snapshot/types'
import { quoteIdent, quoteLiteral } from './identifiers'

export function emitPg(changes: ChangeSet): string {
  return changes.map(emitChange).join('\n')
}

function emitChange(change: Change): string {
  switch (change.kind) {
    case 'createTable':
      return emitCreateTable(change.table)
    case 'dropTable':
      return `DROP TABLE ${quoteIdent(change.table.name)};`
    case 'renameTable':
      return `ALTER TABLE ${quoteIdent(change.from)} RENAME TO ${quoteIdent(change.to)};`
    case 'addColumn':
      return emitAddColumn(change.table, change.column)
    case 'dropColumn':
      return `ALTER TABLE ${quoteIdent(change.table)} DROP COLUMN ${quoteIdent(change.column.name)};`
    case 'renameColumn':
      return `ALTER TABLE ${quoteIdent(change.table)} RENAME COLUMN ${quoteIdent(change.from)} TO ${quoteIdent(change.to)};`
    case 'alterColumn':
      return emitAlterColumn(change.table, change.before, change.after)
    case 'addIndex':
      return emitAddIndex(change.table, change.index)
    case 'dropIndex':
      return `DROP INDEX ${quoteIdent(change.index.name)};`
    case 'addForeignKey':
      return emitAddFk(change.table, change.fk)
    case 'dropForeignKey':
      return `ALTER TABLE ${quoteIdent(change.table)} DROP CONSTRAINT ${quoteIdent(change.fk.name)};`
  }
}

function emitAddColumn(table: string, c: ColumnSnapshot): string {
  return `ALTER TABLE ${quoteIdent(table)} ADD COLUMN ${emitColumnDecl(c)};`
}

function emitAlterColumn(table: string, before: ColumnSnapshot, after: ColumnSnapshot): string {
  const stmts: string[] = []
  const t = quoteIdent(table)
  const c = quoteIdent(after.name)

  const typeChanged = before.type !== after.type
  const nullChanged = before.nullable !== after.nullable
  const defaultChanged = before.default !== after.default
  const losingNotNull = !before.nullable && after.nullable

  if (typeChanged) {
    stmts.push(`ALTER TABLE ${t} ALTER COLUMN ${c} TYPE ${after.type} USING ${c}::${after.type};`)
  }

  // Default precedes nullable when loosening (DROP DEFAULT before DROP NOT NULL keeps
  // each interim state valid). Otherwise nullable precedes default (SET NOT NULL before
  // SET DEFAULT lets the default apply on the now-required column).
  const emitDefault = () => {
    if (!defaultChanged) return
    stmts.push(
      after.default === null
        ? `ALTER TABLE ${t} ALTER COLUMN ${c} DROP DEFAULT;`
        : `ALTER TABLE ${t} ALTER COLUMN ${c} SET DEFAULT ${formatDefault(after.default)};`,
    )
  }
  const emitNullable = () => {
    if (!nullChanged) return
    stmts.push(
      `ALTER TABLE ${t} ALTER COLUMN ${c} ${after.nullable ? 'DROP NOT NULL' : 'SET NOT NULL'};`,
    )
  }

  if (losingNotNull) {
    emitDefault()
    emitNullable()
  } else {
    emitNullable()
    emitDefault()
  }

  return stmts.join('\n')
}

function emitAddIndex(_table: string, _i: import('../snapshot/types').IndexSnapshot): string {
  return '-- index emit: filled in Task 17'
}

function emitAddFk(_table: string, _fk: import('../snapshot/types').ForeignKeySnapshot): string {
  return '-- fk emit: filled in Task 17'
}

function emitCreateTable(t: TableSnapshot): string {
  const cols = Object.values(t.columns).map(emitColumnDecl)
  const pk = Object.values(t.columns)
    .filter((c) => c.primaryKey)
    .map((c) => quoteIdent(c.name))
  const lines = [...cols]
  if (pk.length > 0) lines.push(`PRIMARY KEY (${pk.join(', ')})`)
  return `CREATE TABLE ${quoteIdent(t.name)} (\n  ${lines.join(',\n  ')}\n);`
}

function emitColumnDecl(c: ColumnSnapshot): string {
  let s = `${quoteIdent(c.name)} ${c.type}`
  if (!c.nullable) s += ' NOT NULL'
  if (c.default !== null) s += ` DEFAULT ${formatDefault(c.default)}`
  return s
}

function formatDefault(value: string): string {
  // SQL keywords/functions stay bare; everything else is treated as a literal.
  const upper = value.toUpperCase()
  if (upper === 'CURRENT_TIMESTAMP' || upper === 'NOW()') return value
  if (/^-?\d+(\.\d+)?$/.test(value)) return value // numeric
  if (value === 'true' || value === 'false') return value // boolean literal
  return quoteLiteral(value)
}
