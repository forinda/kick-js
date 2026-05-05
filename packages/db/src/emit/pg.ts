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
    case 'createEnum': {
      const values = change.enum.values.map((v) => quoteLiteral(v)).join(', ')
      return `CREATE TYPE ${quoteIdent(change.enum.name)} AS ENUM (${values});`
    }
    case 'dropEnum':
      return `DROP TYPE ${quoteIdent(change.enum.name)};`
    case 'addEnumValue': {
      const before = change.before ? ` BEFORE ${quoteLiteral(change.before)}` : ''
      return `ALTER TYPE ${quoteIdent(change.enum)} ADD VALUE ${quoteLiteral(change.value)}${before};`
    }
    case 'removeEnumValue':
      return emitRemoveEnumValueRecreate(change)
  }
}

/**
 * Magic header line that the migration runner detects to gate the
 * apply step behind `confirmEnumDrop`. Kept short + on its own line
 * so a `String.includes` is enough to find it. Any change to this
 * literal must also update the runner's check function.
 */
export const ENUM_DROP_HEADER = '-- KICK ENUM REMOVE'

/**
 * Render the rename-recreate dance for a `pgEnum` value removal.
 *
 *   ALTER TYPE foo RENAME TO foo__old
 *   CREATE TYPE foo AS ENUM (…new value list…)
 *   for each affected column:
 *     ALTER TABLE T ALTER COLUMN C TYPE foo USING C::text::foo
 *   DROP TYPE foo__old
 *
 * The block is wrapped in `BEGIN; … COMMIT;` explicitly so the
 * adapter's tx wrapper doesn't double-wrap it; the migration's
 * `meta.json` should set `transaction: false`.
 *
 * The leading `-- KICK ENUM REMOVE` header is the runner's gate
 * signal — without `confirmEnumDrop`, the runner refuses to apply
 * before any DB write happens.
 *
 * Spec: docs/db/spec-enum-value-removal.md.
 */
function emitRemoveEnumValueRecreate(change: {
  enum: string
  removed: readonly string[]
  values: readonly string[]
  affectedColumns: readonly { table: string; column: string }[]
}): string {
  const safeName = sanitizeForLineComment(quoteIdent(change.enum))
  const removedList = change.removed.map((v) => sanitizeForLineComment(quoteLiteral(v))).join(', ')
  const columnsList = change.affectedColumns
    .map((c) => sanitizeForLineComment(`${c.table}.${c.column}`))
    .join(', ')

  const oldTypeName = quoteIdent(`${change.enum}__old`)
  const typeName = quoteIdent(change.enum)
  const valuesList = change.values.map((v) => quoteLiteral(v)).join(', ')

  const header = [
    ENUM_DROP_HEADER,
    `-- enum: ${safeName}`,
    `-- removed: ${removedList}`,
    `-- columns: ${columnsList || '(none)'}`,
    `--`,
    `-- This migration drops values from a PostgreSQL ENUM type. The`,
    `-- runner refuses to apply it without the --confirm-enum-drop flag`,
    `-- (or \`confirmEnumDrop: true\` in RunnerOptions). Inspect the`,
    `-- column USING clauses below to confirm rows holding a removed`,
    `-- value will fail loudly rather than silently coerce.`,
  ]

  const body: string[] = [
    `BEGIN;`,
    `  ALTER TYPE ${typeName} RENAME TO ${oldTypeName};`,
    `  CREATE TYPE ${typeName} AS ENUM (${valuesList});`,
  ]
  for (const col of change.affectedColumns) {
    body.push(
      `  ALTER TABLE ${quoteIdent(col.table)}`,
      `    ALTER COLUMN ${quoteIdent(col.column)} TYPE ${typeName}`,
      `    USING ${quoteIdent(col.column)}::text::${typeName};`,
    )
  }
  body.push(`  DROP TYPE ${oldTypeName};`, `COMMIT;`)

  return [...header, ...body].join('\n')
}

/**
 * Make a value safe to interpolate into a single-line `--` SQL
 * comment. Identifiers and quoted literals normally don't carry
 * line breaks, but the user-supplied portion (enum name + values)
 * can contain anything an adopter passes to `pgEnum()`. A literal
 * `\n` would terminate the comment early and turn the rest of the
 * line into executable SQL.
 *
 * Scope of the sanitiser:
 * - Line-break code points (`\r`, `\n`, `U+2028`, `U+2029`) collapse
 *   runs to a single space so the comment stays on one line.
 * - C0 control bytes excluding tab (0x00-0x08, 0x0B, 0x0C, 0x0E-0x1F)
 *   plus DEL (0x7F) escape to `\x<hh>`.
 * - Tab (0x09) passes through — visually fine inside a `--` comment.
 *
 * Out of scope on purpose: C1 controls (U+0080-U+009F) and other
 * non-ASCII characters pass through unchanged. Adopters do legitimately
 * pass UTF-8 enum names + values (`'café'`, `'naïve'`); aggressively
 * escaping them would degrade the migration file's readability without
 * adding security — only line terminators can break out of a `--`
 * comment, and those are handled above.
 */
function sanitizeForLineComment(value: string): string {
  // Walk code units rather than regex character classes \u2014 control-char
  // regex literals trip `no-control-regex` lints and confuse some
  // editor analysers with "unreachable" warnings on the second
  // replace. Code-unit iteration is unambiguous: for every char we
  // either pass it through, collapse a line-break to a space, or
  // escape a control byte into `\x<hh>`.
  let out = ''
  let prevWasLineBreak = false
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i)
    // Line-break code points \u2192 collapse runs to a single space.
    // Includes \r (0x0D), \n (0x0A), U+2028 (LINE SEPARATOR),
    // U+2029 (PARAGRAPH SEPARATOR).
    const isLineBreak = code === 0x0a || code === 0x0d || code === 0x2028 || code === 0x2029
    if (isLineBreak) {
      if (!prevWasLineBreak) out += ' '
      prevWasLineBreak = true
      continue
    }
    prevWasLineBreak = false
    // Tab (0x09) passes through \u2014 visually fine inside a `--` comment.
    // Other C0 control bytes (0x00-0x08, 0x0B, 0x0C, 0x0E-0x1F) and
    // DEL (0x7F) escape to `\x<hh>` so the migration file stays
    // printable ASCII clean.
    const isControl =
      (code >= 0x00 && code <= 0x08) ||
      code === 0x0b ||
      code === 0x0c ||
      (code >= 0x0e && code <= 0x1f) ||
      code === 0x7f
    if (isControl) {
      out += `\\x${code.toString(16).padStart(2, '0')}`
      continue
    }
    out += value[i]
  }
  return out
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

function emitAddIndex(table: string, i: import('../snapshot/types').IndexSnapshot): string {
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

function emitAddFk(table: string, fk: import('../snapshot/types').ForeignKeySnapshot): string {
  const cols = fk.columns.map(quoteIdent).join(', ')
  const refCols = fk.refColumns.map(quoteIdent).join(', ')
  return (
    `ALTER TABLE ${quoteIdent(table)} ADD CONSTRAINT ${quoteIdent(fk.name)} ` +
    `FOREIGN KEY (${cols}) REFERENCES ${quoteIdent(fk.refTable)} (${refCols}) ` +
    `ON DELETE ${FK_ACTIONS[fk.onDelete]} ON UPDATE ${FK_ACTIONS[fk.onUpdate]};`
  )
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
  // SQL keywords pass through bare.
  if (/^[A-Z_]+$/.test(value)) return value // CURRENT_TIMESTAMP, CURRENT_DATE, NULL, etc.
  // SQL function calls pass through bare: NOW(), gen_random_uuid(), etc.
  if (/^[a-z_][a-z0-9_]*\s*\([^)]*\)$/i.test(value)) return value
  if (/^-?\d+(\.\d+)?$/.test(value)) return value // numeric
  if (value === 'true' || value === 'false') return value // boolean literal
  return quoteLiteral(value)
}
