/**
 * Dates in rows `db.query` nests under a relation. Those rows arrive as
 * JSON, so their dates are strings even where the driver parses top-level
 * ones. These decoders read them the way the driver reads a top-level
 * value, so a nested `createdAt` equals the same column read directly.
 */

type Decoder = (v: unknown) => unknown

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/

/** `YYYY-MM-DD` at local midnight — how node-postgres and mysql2 ('local') read a date. */
function localDate(s: string): Date | undefined {
  const m = DATE_ONLY.exec(s)
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : undefined
}

function toDate(parse: (s: string) => Date): Decoder {
  return (v) => {
    if (typeof v !== 'string') return v
    const d = parse(v)
    return Number.isNaN(d.getTime()) ? v : d
  }
}

/**
 * node-postgres: `timestamptz` carries its offset; `timestamp` and `date`
 * have none and read as local time.
 */
const pgDate = toDate((s) => localDate(s) ?? new Date(s))

/**
 * mysql2 reads DATETIME / TIMESTAMP / DATE in the pool's `timezone`:
 * `'local'` (its default), `'Z'`, or an offset like `'+02:00'`.
 */
function mysqlDate(timezone: string): Decoder {
  const zone =
    timezone === 'local' ? '' : timezone === 'Z' || /^utc$/i.test(timezone) ? 'Z' : timezone
  return toDate((s) => {
    if (!zone) return localDate(s) ?? new Date(s.replace(' ', 'T'))
    const iso = DATE_ONLY.test(s) ? `${s}T00:00:00` : s.replace(' ', 'T')
    return new Date(`${iso}${zone}`)
  })
}

const DATE_TYPES = new Set(['timestamp', 'timestamptz', 'date', 'datetime'])

/** `datetime(3)` → `datetime`. */
const baseType = (type: string) => type.replace(/\(.*$/, '')

/** The MySQL type kick/db emits for each date column type — the names `dateStrings` lists. */
const MYSQL_TYPE: Record<string, string> = {
  timestamp: 'TIMESTAMP',
  timestamptz: 'TIMESTAMP',
  date: 'DATE',
  datetime: 'DATETIME',
}

/** The nested-row decoder for a column type, or `undefined` when the dialect needs none. */
export function nestedDateDecoder(
  dialect: string | undefined,
  dates?: { timezone: string; dateStrings: boolean | readonly string[] },
): ((type: string) => Decoder | undefined) | undefined {
  if (dialect === 'postgres') return (type) => (DATE_TYPES.has(baseType(type)) ? pgDate : undefined)
  if (dialect === 'mysql') {
    const decode = mysqlDate(dates?.timezone ?? 'local')
    const asStrings = dates?.dateStrings ?? false
    // mysql2's `dateStrings` keeps these types as strings at the top level.
    const kept = (type: string) =>
      asStrings === true ||
      (Array.isArray(asStrings) && asStrings.includes(MYSQL_TYPE[baseType(type)]!))
    return (type) => (DATE_TYPES.has(baseType(type)) && !kept(type) ? decode : undefined)
  }
  return undefined
}
