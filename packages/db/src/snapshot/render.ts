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
  const { helperName, args } = pickColumnHelper(col)
  helpers.add(helperName)

  let chain = `${helperName}(${args})`
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

function pickColumnHelper(col: ColumnSnapshot): { helperName: string; args: string } {
  // Strip array suffix; render as base type + .array() chain in renderColumn
  // (M2 — for now arrays land as a literal `<T>[]` type which the DSL doesn't
  // round-trip). For M1, just pick the closest helper.
  const t = col.type

  if (t === 'serial') return { helperName: 'serial', args: '' }
  if (t === 'bigserial') return { helperName: 'bigSerial', args: '' }
  if (t === 'smallserial') return { helperName: 'serial', args: '' }
  if (t === 'integer') return { helperName: 'integer', args: '' }
  if (t === 'bigint') return { helperName: 'bigint', args: '' }
  if (t === 'smallint') return { helperName: 'smallint', args: '' }
  if (t === 'real') return { helperName: 'real', args: '' }
  if (t === 'double precision') return { helperName: 'doublePrecision', args: '' }
  if (/^numeric(\(.+\))?$/.test(t)) return { helperName: 'numeric', args: extractParens(t) }
  if (/^varchar(\(\d+\))?$/.test(t)) return { helperName: 'varchar', args: extractParens(t) }
  if (/^char(\(\d+\))?$/.test(t)) return { helperName: 'char', args: extractParens(t) }
  if (t === 'text') return { helperName: 'text', args: '' }
  if (t === 'boolean') return { helperName: 'boolean', args: '' }
  if (t === 'timestamp') return { helperName: 'timestamp', args: '' }
  if (t === 'timestamptz') return { helperName: 'timestamptz', args: '' }
  if (t === 'date') return { helperName: 'date', args: '' }
  if (t === 'time') return { helperName: 'time', args: '' }
  if (t === 'interval') return { helperName: 'interval', args: '' }
  if (t === 'uuid') return { helperName: 'uuid', args: '' }
  if (t === 'jsonb') return { helperName: 'jsonb', args: '' }
  if (t === 'json') return { helperName: 'json', args: '' }
  if (t === 'bytea') return { helperName: 'bytea', args: '' }

  // Fallback: emit as a comment + placeholder text() so the file still
  // parses. Adopter edits to the right helper.
  return { helperName: 'text', args: `/* TODO: ${t} */` }
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
