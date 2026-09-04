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
  for (const col of Object.values(table.columns)) {
    const fk = table.foreignKeys.find(
      (f) =>
        f.columns.length === 1 &&
        f.columns[0] === col.name &&
        f.name === `${table.name}_${col.name}_fk`,
    )
    const inlineUnique =
      table.indexes.find(
        (i) =>
          i.unique &&
          i.columns.length === 1 &&
          i.columns[0] === col.name &&
          isAutoUniqueName(table.name, i),
      ) !== undefined
    columns.push(`  ${jsKey(col.name)}: ${renderColumn(col, helpers, fk, inlineUnique)},`)
  }

  // Constraints that don't fit on a column chain.
  const explicitIndexes = table.indexes.filter((i) => !isAutoUniqueName(table.name, i))
  const explicitFks = table.foreignKeys.filter(
    (f) => f.name !== `${table.name}_${f.columns[0]}_fk` || f.columns.length !== 1,
  )

  const hasThirdArg = explicitIndexes.length > 0
  const tableArgs: string[] = [`'${table.name}'`, `{\n${columns.join('\n')}\n}`]

  if (hasThirdArg) {
    const callbacks = explicitIndexes
      .map((i) => `    ${jsKey(i.name)}: ${renderIndexCall(i)}`)
      .join(',\n')
    tableArgs.push(`(t) => ({\n${callbacks},\n  })`)
  }

  let src = `export const ${ident} = table(${tableArgs.join(', ')})`

  // Explicit FKs that don't fit the auto-derived <table>_<col>_fk pattern get
  // logged as TODO comments — adopter handles them manually. M3 may upgrade
  // this to emit a separate ALTER snippet.
  if (explicitFks.length > 0) {
    src +=
      '\n// TODO: kick db introspect — composite or custom-named foreign keys not auto-rendered:\n'
    for (const f of explicitFks) {
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
    const onDelete = fk.onDelete === 'no_action' ? '' : `, { onDelete: '${fk.onDelete}' }`
    chain += `.references(() => ${ref}${onDelete})`
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
  return `${helper}('${idx.name}').on(${cols})`
}

function isAutoUniqueName(tableName: string, idx: IndexSnapshot): boolean {
  return (
    idx.unique && idx.columns.length === 1 && idx.name === `${tableName}_${idx.columns[0]}_unique`
  )
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
