import { derivedFkName, derivedUniqueName } from './name'
import type {
  ColumnSnapshot,
  ForeignKeySnapshot,
  IndexSnapshot,
  SchemaSnapshot,
  TableSnapshot,
} from './types'

/**
 * Render a SchemaSnapshot to TypeScript source matching the kickjs-db DSL.
 * Inverse of extractSnapshot().
 *
 * Naming: tables become exported `const`s with the same name. Constants
 * starting with digits get an underscore prefix to stay JS-valid.
 *
 * Limits (M1 — refined in M2/M3):
 *   - No relations() emission. Adopter adds them manually post-introspect.
 *   - No checks (M1 doesn't model CHECK constraints in the snapshot).
 *   - Default values pass through as-is. The DSL accepts string defaults,
 *     so 'true' / 'CURRENT_TIMESTAMP' / "'foo'" all round-trip.
 *   - Auto-derived constraint names (`<table>_<col>_unique`, `<table>_<col>_fk`)
 *     are detected and rendered as the chained .unique() / .references() form.
 *     Custom-named constraints fall back to the third-arg callback / FK helper.
 */
export function renderSchemaSource(snapshot: SchemaSnapshot): string {
  const usedColumnHelpers = new Set<string>()
  const tableSources: string[] = []

  // First pass: render every table, accumulating which column helpers we used.
  for (const table of Object.values(snapshot.tables)) {
    tableSources.push(renderTable(table, usedColumnHelpers))
  }

  const helpers = ['table', ...Array.from(usedColumnHelpers).toSorted()]
  // Common constraint helpers used by tables with secondary objects.
  const needsIndex = Object.values(snapshot.tables).some((t) =>
    t.indexes.some((i) => !isAutoUniqueName(t.name, i)),
  )
  if (needsIndex) helpers.push('index')
  const needsUnique = Object.values(snapshot.tables).some((t) =>
    t.indexes.some((i) => i.unique && !isAutoUniqueName(t.name, i)),
  )
  if (needsUnique && !helpers.includes('unique')) helpers.push('unique')

  const importLine = `import { ${helpers.join(', ')} } from '@forinda/kickjs-db'`
  return [importLine, '', ...tableSources].join('\n').trimEnd() + '\n'
}

function renderTable(table: TableSnapshot, helpers: Set<string>): string {
  const ident = jsIdent(table.name)
  const columns: string[] = []

  // Grouped so a column with more than one foreign key is visible as such.
  const singleColumnFks = new Map<string, ForeignKeySnapshot[]>()
  for (const f of table.foreignKeys) {
    if (f.columns.length !== 1) continue
    const list = singleColumnFks.get(f.columns[0]) ?? []
    list.push(f)
    singleColumnFks.set(f.columns[0], list)
  }
  /** The ones actually rendered on a column; everything else is deferred. */
  const inlined = new Set<ForeignKeySnapshot>()
  for (const col of Object.values(table.columns)) {
    // Match on SHAPE — one column, this column — not on the constraint's name.
    //
    // Matching by name meant only `<table>_<col>_fk` was ever inlined, which is
    // the name this DSL derives. A real database names constraints itself:
    // Postgres' default is `<table>_<col>_fkey`, and a DBA may have chosen
    // anything at all. So introspecting a live schema matched nothing and every
    // foreign key fell through to a TODO comment — 1,330 of them on a
    // 242-table schema (#643). The name is preserved separately below.
    //
    // Exactly one, or none: `.references()` says "this column points at X", and
    // a column carrying two constraints cannot say both. Inlining the first
    // would make the file look complete while the second lived only in a
    // comment, so neither is inlined and both are reported below.
    const candidates = singleColumnFks.get(col.name) ?? []
    const fk = candidates.length === 1 ? candidates[0] : undefined
    if (fk) inlined.add(fk)
    const inlineUnique =
      table.indexes.find(
        (i) =>
          i.unique &&
          i.columns.length === 1 &&
          i.columns[0] === col.name &&
          isAutoUniqueName(table.name, i),
      ) !== undefined
    columns.push(
      `  ${jsKey(col.name)}: ${renderColumn(col, helpers, fk, inlineUnique, table.name)},`,
    )
  }

  // Constraints that don't fit on a column chain.
  const explicitIndexes = table.indexes.filter((i) => !isAutoUniqueName(table.name, i))
  // Whatever did not render on a column: composite keys, which have no
  // column-level form, and the members of any column carrying more than one.
  const deferredFks = table.foreignKeys.filter((f) => !inlined.has(f))

  const hasThirdArg = explicitIndexes.length > 0
  const tableArgs: string[] = [strLit(table.name), `{\n${columns.join('\n')}\n}`]

  if (hasThirdArg) {
    const callbacks = explicitIndexes
      .map((i) => `    ${jsKey(i.name)}: ${renderIndexCall(i)}`)
      .join(',\n')
    tableArgs.push(`(t) => ({\n${callbacks},\n  })`)
  }

  let src = `export const ${ident} = table(${tableArgs.join(', ')})`

  // Foreign keys with no column-level form in the DSL are logged as TODO
  // comments for the adopter to handle. M3 may upgrade this to emit a separate
  // ALTER snippet.
  if (deferredFks.length > 0) {
    src +=
      '\n// TODO: kick db introspect — composite foreign keys, and columns with more than one, not auto-rendered:\n'
    for (const f of deferredFks) {
      src += `// ${f.name}: (${f.columns.join(', ')}) → ${f.refTable}(${f.refColumns.join(', ')})\n`
    }
  }

  return src
}

function renderColumn(
  col: ColumnSnapshot,
  helpers: Set<string>,
  fk: ForeignKeySnapshot | undefined,
  inlineUnique: boolean,
  tableName: string,
): string {
  const { helperName, args, isArray } = pickColumnHelper(col)
  helpers.add(helperName)

  // `.array()` goes first in the chain: it rewrites the column's type, and
  // reads as part of the type rather than as a constraint on it.
  let chain = `${helperName}(${args})${isArray ? '.array()' : ''}`
  if (col.primaryKey) chain += '.primaryKey()'
  if (!col.primaryKey && !col.nullable) chain += '.notNull()'
  if (col.default !== null) chain += `.default(${JSON.stringify(col.default)})`
  if (inlineUnique) chain += '.unique()'
  if (fk) {
    const ref = `${jsIdent(fk.refTable)}.${jsIdent(fk.refColumns[0])}`
    const opts: string[] = []
    if (fk.onDelete !== 'no_action') opts.push(`onDelete: '${fk.onDelete}'`)
    if (fk.onUpdate !== undefined && fk.onUpdate !== 'no_action') {
      opts.push(`onUpdate: '${fk.onUpdate}'`)
    }
    // Carry the real constraint name whenever it isn't the one the DSL would
    // derive, so re-extracting this file reproduces the database rather than
    // proposing a rename of every key.
    if (fk.name !== derivedFkName(tableName, col.name)) opts.push(`name: ${strLit(fk.name)}`)
    const optArg = opts.length > 0 ? `, { ${opts.join(', ')} }` : ''
    chain += `.references(() => ${ref}${optArg})`
  }
  return chain
}

function pickColumnHelper(col: ColumnSnapshot): {
  helperName: string
  args: string
  isArray: boolean
} {
  // An array type is its element type plus `.array()`. Introspect already
  // reports `integer[]`, but every such column used to miss every branch below
  // and land on the `text(/* TODO */)` fallback, losing the element type and
  // the array-ness together (#648).
  const isArray = col.type.endsWith('[]')
  const t = isArray ? col.type.slice(0, -2) : col.type

  if (t === 'serial') return { helperName: 'serial', args: '', isArray }
  if (t === 'bigserial') return { helperName: 'bigSerial', args: '', isArray }
  if (t === 'smallserial') return { helperName: 'serial', args: '', isArray }
  if (t === 'integer') return { helperName: 'integer', args: '', isArray }
  if (t === 'bigint') return { helperName: 'bigint', args: '', isArray }
  if (t === 'smallint') return { helperName: 'smallint', args: '', isArray }
  if (t === 'real') return { helperName: 'real', args: '', isArray }
  if (t === 'double precision') return { helperName: 'doublePrecision', args: '', isArray }
  if (/^numeric(\(.+\))?$/.test(t))
    return { helperName: 'numeric', args: extractParens(t), isArray }
  if (/^varchar(\(\d+\))?$/.test(t))
    return { helperName: 'varchar', args: extractParens(t), isArray }
  if (/^char(\(\d+\))?$/.test(t)) return { helperName: 'char', args: extractParens(t), isArray }
  if (t === 'text') return { helperName: 'text', args: '', isArray }
  if (t === 'boolean') return { helperName: 'boolean', args: '', isArray }
  if (t === 'timestamp') return { helperName: 'timestamp', args: '', isArray }
  if (t === 'timestamptz') return { helperName: 'timestamptz', args: '', isArray }
  if (t === 'date') return { helperName: 'date', args: '', isArray }
  if (t === 'time') return { helperName: 'time', args: '', isArray }
  if (t === 'interval') return { helperName: 'interval', args: '', isArray }
  if (t === 'uuid') return { helperName: 'uuid', args: '', isArray }
  if (t === 'jsonb') return { helperName: 'jsonb', args: '', isArray }
  if (t === 'json') return { helperName: 'json', args: '', isArray }
  if (t === 'bytea') return { helperName: 'bytea', args: '', isArray }

  // Fallback: emit as a comment + placeholder text() so the file still
  // parses. Adopter edits to the right helper. `isArray` still rides along, so
  // an array of an unmapped element type keeps at least its array-ness.
  return { helperName: 'text', args: `/* TODO: ${t} */`, isArray }
}

function extractParens(t: string): string {
  const m = t.match(/\(([^)]+)\)/)
  return m ? m[1] : ''
}

function renderIndexCall(idx: IndexSnapshot): string {
  const helper = idx.unique ? 'unique' : 'index'
  const cols = idx.columns.map((c) => `t.${jsIdent(c)}`).join(', ')
  return `${helper}(${strLit(idx.name)}).on(${cols})`
}

function isAutoUniqueName(tableName: string, idx: IndexSnapshot): boolean {
  return (
    idx.unique &&
    idx.columns.length === 1 &&
    idx.name === derivedUniqueName(tableName, idx.columns[0])
  )
}

/**
 * Render a database-supplied string as a JS literal.
 *
 * Table, index and constraint names come from the database, and a quoted
 * Postgres identifier may legally contain a quote or a backslash —
 * `"customer'fk"` is a valid constraint name. Interpolating one straight into a
 * single-quoted literal produced a schema file that did not parse.
 *
 * Single quotes are kept for everything that can hold them verbatim, so
 * ordinary names render exactly as they always have; anything else falls back
 * to JSON, which escapes quotes, backslashes and line terminators alike.
 */
function strLit(value: string): string {
  return /^[^'\\\r\n\u2028\u2029]*$/.test(value) ? `'${value}'` : JSON.stringify(value)
}

/** Make a JS-safe identifier from a snake_case column/table name. */
function jsIdent(raw: string): string {
  if (/^[A-Za-z_$][\w$]*$/.test(raw)) return raw
  // Prefix digits-leading names with underscore.
  return `_${raw.replace(/[^\w$]/g, '_')}`
}

/** Render a record key — quoted if not a valid identifier. */
function jsKey(raw: string): string {
  return /^[A-Za-z_$][\w$]*$/.test(raw) ? raw : JSON.stringify(raw)
}
