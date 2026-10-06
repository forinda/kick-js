/**
 * Generated seed data: rows that fit a table's columns — types, lengths,
 * enums, uniqueness, foreign keys — the same every time for the same seed.
 *
 * Columns the database or kick/db fills (defaults, `$defaultFn`, serials,
 * identity, generated and managed columns) are left to it, except a primary
 * key that isn't auto-incremented (a uuid), which gets a value so children
 * can point at it and runs stay reproducible.
 */
import { qualifiedTableName, unwrapTable, type TableDecl } from '../dsl/table'
import type { ColumnBuilder, ColumnRef, ColumnState } from '../dsl/columns/types'
import type { KickDbClient } from '../client/types'

type Row = Record<string, unknown>

/** What an override gets: the row's index and a random number source seeded for that column. */
export interface FakeContext {
  index: number
  /** A number in [0, 1), the same sequence every run for the same seed. */
  random: () => number
}

/** A column's value: fixed, or computed per row. */
export type FakeOverride = unknown | ((ctx: FakeContext) => unknown)

export interface FakeRowsOptions {
  count: number
  /** The same seed gives the same rows. Default `1`. */
  seed?: number
  /** Values for columns, by column key: fixed, or `(ctx) => value`. */
  overrides?: Record<string, FakeOverride>
  /** Values a foreign-key column picks from, by column key — usually the parent rows' keys. */
  refs?: Record<string, readonly unknown[]>
}

export interface SeedFakeOptions {
  /** How many rows per table, by table name (as `db.insertInto` takes it). */
  counts: Record<string, number>
  /** The same seed gives the same rows. Default `1`. */
  seed?: number
  /** Per table, per column key: fixed values or `(ctx) => value`. */
  overrides?: Record<string, Record<string, FakeOverride>>
}

// ── random ────────────────────────────────────────────────────────────────

function hash(text: string): number {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619)
  return h >>> 0
}

/** mulberry32: small, fast, and the same everywhere. */
function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const pick = <T>(random: () => number, list: readonly T[]): T =>
  list[Math.floor(random() * list.length)]!
const int = (random: () => number, min: number, max: number) =>
  min + Math.floor(random() * (max - min + 1))

const WORDS = [
  'alpha',
  'amber',
  'atlas',
  'beacon',
  'birch',
  'bright',
  'canyon',
  'cedar',
  'cobalt',
  'coral',
  'delta',
  'ember',
  'falcon',
  'fern',
  'glacier',
  'harbor',
  'indigo',
  'jade',
  'juniper',
  'lagoon',
  'lantern',
  'maple',
  'meadow',
  'nova',
  'orbit',
  'pine',
  'prairie',
  'quartz',
  'raven',
  'river',
  'sage',
  'sierra',
  'summit',
  'timber',
  'tundra',
  'velvet',
  'willow',
  'zephyr',
]
const FIRST = [
  'Ada',
  'Alan',
  'Grace',
  'Linus',
  'Margaret',
  'Dennis',
  'Barbara',
  'Ken',
  'Radia',
  'Tim',
  'Katherine',
  'Edsger',
]
const LAST = [
  'Lovelace',
  'Turing',
  'Hopper',
  'Torvalds',
  'Hamilton',
  'Ritchie',
  'Liskov',
  'Thompson',
  'Perlman',
  'Berners',
  'Johnson',
  'Dijkstra',
]

const words = (random: () => number, n: number) =>
  Array.from({ length: n }, () => pick(random, WORDS)).join(' ')
const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

function uuidFrom(random: () => number): string {
  const hex = Array.from({ length: 32 }, () => int(random, 0, 15).toString(16))
  hex[12] = '4'
  hex[16] = '89ab'[int(random, 0, 3)]!
  const h = hex.join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

// ── one column ────────────────────────────────────────────────────────────

const PEOPLE = /user|person|people|author|member|customer|contact|employee|student|account|profile/

/** Text shaped by what the column is called — `email`, `name`, `slug`… */
function textFor(
  table: string,
  key: string,
  random: () => number,
  index: number,
  unique: boolean,
): string {
  const k = key.toLowerCase()
  const first = pick(random, FIRST)
  const last = pick(random, LAST)
  // Unique text keeps the row index, so no two rows can clash.
  const n = unique ? `${index + 1}` : ''
  if (k.includes('email'))
    return `${first}.${last}${n || int(random, 1, 99)}@example.com`.toLowerCase()
  if (k.includes('url') || k.includes('website'))
    return `https://example.com/${pick(random, WORDS)}${n}`
  if (k.includes('phone')) return `+1555${String(int(random, 0, 9999999)).padStart(7, '0')}`
  if (k === 'firstname') return first + n
  if (k === 'lastname') return last + n
  // A `name` is a person's on a people table, otherwise a short title.
  if (
    k === 'fullname' ||
    (k.includes('name') && !k.includes('user') && PEOPLE.test(table.toLowerCase()))
  ) {
    return `${first} ${last}${n ? ` ${n}` : ''}`
  }
  if (k.includes('name') && !k.includes('user'))
    return capitalise(words(random, 2)) + (n ? ` ${n}` : '')
  if (k.includes('slug') || k.includes('handle') || k.includes('username')) {
    return `${pick(random, WORDS)}-${pick(random, WORDS)}${n ? `-${n}` : ''}`
  }
  if (k.includes('password') || k.includes('hash') || k.includes('token')) {
    return Array.from({ length: 32 }, () => int(random, 0, 15).toString(16)).join('')
  }
  if (k.includes('title') || k.includes('subject'))
    return capitalise(words(random, 3)) + (n ? ` ${n}` : '')
  if (
    ['body', 'description', 'content', 'bio', 'note', 'notes', 'summary', 'message'].some((w) =>
      k.includes(w),
    )
  ) {
    return `${capitalise(words(random, int(random, 6, 14)))}.`
  }
  return words(random, 2) + (n ? ` ${n}` : '')
}

const INT_RANGES: Record<string, [number, number]> = {
  tinyint: [0, 127],
  smallint: [0, 32767],
  mediumint: [0, 8388607],
  integer: [0, 1_000_000],
  int: [0, 1_000_000],
  bigint: [0, 1_000_000_000],
}

/** A value for the column, or `undefined` when its type can't be generated. */
function valueFor(
  table: string,
  key: string,
  builder: ColumnBuilder,
  state: ColumnState,
  random: () => number,
  index: number,
  unique: boolean,
): unknown {
  // Read by shape, not class, so a second copy of the package still matches.
  const enumValues = (builder as { values?: unknown }).values
  if (Array.isArray(enumValues) && 'enumName' in builder) return pick(random, enumValues)
  if ('toDriver' in builder || 'fromDriver' in builder) return undefined // a custom type
  const type = state.type.toLowerCase()
  const base = type.replace(/\(.*$/, '').trim()
  const length = Number(/\((\d+)/.exec(type)?.[1]) || undefined

  if (base === 'enum') {
    const values = [...type.matchAll(/'((?:[^']|'')*)'/g)].map((m) => m[1]!.replace(/''/g, "'"))
    return values.length ? pick(random, values) : undefined
  }
  if (base === 'uuid') return uuidFrom(random)
  if (['text', 'varchar', 'char', 'citext', 'character varying'].includes(base)) {
    const text = textFor(table, key, random, index, unique)
    if (!length || text.length <= length) return text
    // Keep the unique suffix when shortening.
    const suffix = unique ? `-${index + 1}` : ''
    return text.slice(0, Math.max(0, length - suffix.length)) + suffix
  }
  if (base in INT_RANGES) {
    const [min, max] = INT_RANGES[base]!
    const value = unique ? index + 1 : int(random, min, max)
    return base === 'bigint' && state.mode === 'bigint' ? BigInt(value) : value
  }
  if (base === 'numeric' || base === 'decimal') {
    const [precision = 10, scale = 2] = (/\((\d+)\s*(?:,\s*(\d+))?\)/.exec(type) ?? [])
      .slice(1)
      .map((d) => (d === undefined ? undefined : Number(d))) as [number?, number?]
    const whole = Math.min(precision - scale, 6)
    const value = (random() * 10 ** whole).toFixed(scale)
    return state.mode === 'number' ? Number(value) : value
  }
  if (base === 'real' || base === 'double precision' || base === 'float' || base === 'double') {
    return Math.round(random() * 100_000) / 100
  }
  if (base === 'boolean' || base === 'bool') return random() < 0.5
  if (['timestamp', 'timestamptz', 'datetime'].includes(base)) {
    // Within a year before 2026-01-01, to the second.
    return new Date(Date.UTC(2026, 0, 1) - int(random, 0, 365 * 86_400) * 1000)
  }
  if (base === 'date') {
    return new Date(Date.UTC(2026, 0, 1) - int(random, 0, 365) * 86_400_000)
      .toISOString()
      .slice(0, 10)
  }
  if (base === 'time') {
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${pad(int(random, 0, 23))}:${pad(int(random, 0, 59))}:${pad(int(random, 0, 59))}`
  }
  if (base === 'json' || base === 'jsonb') return {}
  return undefined
}

const isAutoIncrement = (state: ColumnState) =>
  /serial/.test(state.type.toLowerCase()) || state.identity !== undefined

/** Left to the database or kick/db — except a key children need to point at. */
function filledElsewhere(state: ColumnState): boolean {
  // A tenant column is filled by the tenancy plugin (seed inside tenancy.run).
  if (state.generated || state.identity || state.managed || state.tenancy || isAutoIncrement(state))
    return true
  if (state.primaryKey) return false
  return state.default !== null || state.defaultFn !== undefined
}

function uniqueKeys(table: TableDecl): Set<string> {
  const keys = new Set<string>()
  for (const [key, builder] of Object.entries(table.__columns)) {
    const s = (builder as ColumnBuilder).__state()
    if (s.unique || s.primaryKey) keys.add(key)
  }
  for (const index of table.__indexes) {
    if (index.unique && index.columns.length === 1) keys.add(index.columns[0]!)
  }
  return keys
}

/** The primary key or a unique index made only of foreign-key columns, or none. */
function compositeForeignKey(table: TableDecl, fks: Map<string, ColumnRef>): string[] {
  const candidates = [
    table.__primaryKey?.columns ?? [],
    ...table.__indexes.filter((i) => i.unique).map((i) => i.columns),
  ]
  return candidates.find((cols) => cols.length > 1 && cols.every((c) => fks.has(c))) ?? []
}

/** Foreign-key columns, by key, with the table and column they point at. */
function foreignKeys(table: TableDecl): Map<string, ColumnRef> {
  const out = new Map<string, ColumnRef>()
  for (const [key, builder] of Object.entries(table.__columns)) {
    const ref = (builder as ColumnBuilder).__state().references?.thunk()
    if (ref) out.set(key, ref)
  }
  return out
}

/**
 * Rows for a table, without a database — the same rows for the same seed.
 *
 * ```ts
 * const rows = fakeRows(users, { count: 10, overrides: { role: 'member' } })
 * ```
 *
 * Foreign-key columns take their values from `refs` (a nullable one is
 * `null` without them). A table with several foreign keys — a junction —
 * gets distinct combinations, so its key doesn't collide.
 */
export function fakeRows(tableLike: unknown, options: FakeRowsOptions): Row[] {
  const table = unwrapTable(tableLike)
  if (!table) throw new Error('kickjs-db: fakeRows() needs a table')
  const name = qualifiedTableName(table)
  const seed = options.seed ?? 1
  const unique = uniqueKeys(table)
  const fks = foreignKeys(table)
  // A key made only of foreign keys (a junction's) is walked first, so its
  // combinations are distinct; asking for more rows than there are is an error.
  const keySet = compositeForeignKey(table, fks)
  const fkKeys = [...fks.keys()]
    .filter((k) => options.refs?.[k]?.length)
    .toSorted((a, b) => Number(keySet.includes(b)) - Number(keySet.includes(a)))
  if (keySet.length > 0 && keySet.every((k) => options.refs?.[k]?.length)) {
    const capacity = keySet.reduce((n, k) => n * options.refs![k]!.length, 1)
    if (options.count > capacity) {
      throw new Error(
        `kickjs-db: ${name} can hold ${capacity} distinct (${keySet.join(', ')}) — asked for ${options.count}`,
      )
    }
  }

  const columns = Object.entries(table.__columns).map(([key, builder]) => ({
    key,
    builder: builder as ColumnBuilder,
    state: (builder as ColumnBuilder).__state(),
    random: rng(hash(`${seed}:${name}:${key}`)),
  }))

  const rows: Row[] = []
  for (let index = 0; index < options.count; index++) {
    const row: Row = {}
    // Mixed radix over the foreign keys: distinct combinations, row by row.
    let rest = index
    for (const { key, builder, state, random } of columns) {
      const override = options.overrides?.[key]
      if (override !== undefined) {
        row[key] = typeof override === 'function' ? override({ index, random }) : override
        continue
      }
      if (fks.has(key)) {
        const pool = options.refs?.[key]
        if (pool?.length) {
          row[key] = pool[rest % pool.length]
          if (fkKeys.indexOf(key) < fkKeys.length - 1) rest = Math.floor(rest / pool.length)
          continue
        }
        if (state.nullable) {
          row[key] = null
          continue
        }
        throw new Error(
          `kickjs-db: ${name}.${key} points at ${fks.get(key)!.__tableName} — give it rows to point at (counts, or refs), or an override`,
        )
      }
      if (filledElsewhere(state)) continue
      const value = valueFor(name, key, builder, state, random, index, unique.has(key))
      if (value !== undefined) row[key] = value
      else if (state.nullable) row[key] = null
      else {
        throw new Error(
          `kickjs-db: can't make up a value for ${name}.${key} (${state.type}) — give it an override`,
        )
      }
    }
    rows.push(row)
  }
  return rows
}

/** The tables in `counts`, parents before children. */
function insertOrder(tables: Map<string, TableDecl>, names: string[]): string[] {
  const order: string[] = []
  const seen = new Set<string>()
  const visit = (name: string, path: string[]) => {
    if (seen.has(name)) return
    if (path.includes(name)) {
      throw new Error(
        `kickjs-db: seedFake can't order ${[...path, name].join(' → ')} — a cycle of required foreign keys`,
      )
    }
    const table = tables.get(name)!
    for (const ref of foreignKeys(table).values()) {
      if (ref.__tableName !== name && names.includes(ref.__tableName))
        visit(ref.__tableName, [...path, name])
    }
    seen.add(name)
    order.push(name)
  }
  for (const name of names) visit(name, [])
  return order
}

/**
 * Fill tables with generated rows, parents first, children pointing at them.
 * A foreign key to a table not in `counts` points at rows already there.
 * Returns the inserted rows by table.
 *
 * ```ts
 * // db/seeds/02_sample.ts
 * export default () => seedFake(db, schema, { counts: { users: 10, posts: 50 } })
 * ```
 */
export async function seedFake<DB>(
  db: KickDbClient<DB>,
  schema: Record<string, unknown>,
  options: SeedFakeOptions,
): Promise<Record<string, Row[]>> {
  const tables = new Map<string, TableDecl>()
  for (const exported of Object.values(schema)) {
    const table = unwrapTable(exported)
    if (table) tables.set(qualifiedTableName(table), table)
  }
  const names = Object.keys(options.counts)
  for (const name of names) {
    if (!tables.has(name)) throw new Error(`kickjs-db: seedFake: no table '${name}' in the schema`)
  }

  const client = db as unknown as {
    dialect: string
    insertInto: (t: string) => any
    selectFrom: (t: string) => any
  }
  const inserted: Record<string, Row[]> = {}
  for (const name of insertOrder(tables, names)) {
    const table = tables.get(name)!
    const refs: Record<string, unknown[]> = {}
    for (const [key, ref] of foreignKeys(table)) {
      if (ref.__tableName === name) continue // self-reference: null when nullable
      const parent =
        inserted[ref.__tableName] ??
        (await client.selectFrom(ref.__tableName).select(ref.__name).limit(1000).execute())
      refs[key] = parent.map((r: Row) => r[ref.__name])
    }
    const rows = fakeRows(table, {
      count: options.counts[name]!,
      seed: options.seed,
      overrides: options.overrides?.[name],
      refs,
    })
    inserted[name] = await insertRows(client, name, table, rows)
  }
  return inserted
}

/** Insert and read back what the database filled in (keys, defaults). */
async function insertRows(
  client: { dialect: string; insertInto: (t: string) => any; selectFrom: (t: string) => any },
  name: string,
  table: TableDecl,
  rows: Row[],
): Promise<Row[]> {
  if (rows.length === 0) return []
  if (client.dialect !== 'mysql') {
    const out: Row[] = []
    // Kept well under the parameter limits of every driver.
    for (let i = 0; i < rows.length; i += 200) {
      out.push(
        ...(await client
          .insertInto(name)
          .values(rows.slice(i, i + 200))
          .returningAll()
          .execute()),
      )
    }
    return out
  }
  // MySQL has no RETURNING: insert one row at a time, then read it back by its
  // key (an auto-increment one from insertId) for what the database filled in.
  const keys =
    table.__primaryKey?.columns ??
    Object.entries(table.__columns)
      .filter(([, b]) => (b as ColumnBuilder).__state().primaryKey)
      .map(([k]) => k)
  const autoKey = keys.find((k) => isAutoIncrement((table.__columns[k] as ColumnBuilder).__state()))
  const out: Row[] = []
  for (const row of rows) {
    const result = await client.insertInto(name).values(row).executeTakeFirst()
    const key: Row = { ...row, ...(autoKey ? { [autoKey]: Number(result.insertId) } : {}) }
    if (keys.length === 0) {
      out.push(key)
      continue
    }
    let query = client.selectFrom(name).selectAll()
    for (const k of keys) query = query.where(k, '=', key[k])
    out.push((await query.executeTakeFirst()) ?? key)
  }
  return out
}
