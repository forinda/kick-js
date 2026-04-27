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
    default:
      return `-- unsupported in M0: ${change.kind}`
  }
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
