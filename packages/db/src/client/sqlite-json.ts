/**
 * JSON and array columns on SQLite. SQLite has neither type, and
 * better-sqlite3 binds no object, so writing `json()` / `jsonb()` / `.array()`
 * values threw. They're stored as JSON text and read back parsed — what
 * Postgres returns for the same columns.
 */

type Codec = (v: unknown) => unknown

const isJsonColumn = (type: string) => type === 'json' || type === 'jsonb' || type.endsWith('[]')

const encode: Codec = (v) =>
  typeof v === 'object' && v !== null && !(v instanceof Uint8Array) && !(v instanceof Date)
    ? JSON.stringify(v)
    : v

const decode: Codec = (v) => {
  if (typeof v !== 'string') return v
  try {
    return JSON.parse(v)
  } catch {
    return v
  }
}

export const sqliteJsonEncoder = (type: string): Codec | undefined =>
  isJsonColumn(type) ? encode : undefined

export const sqliteJsonDecoder = (type: string): Codec | undefined =>
  isJsonColumn(type) ? decode : undefined
