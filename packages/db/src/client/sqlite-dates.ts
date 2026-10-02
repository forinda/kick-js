/**
 * Dates on SQLite. better-sqlite3 binds no `Date` and returns `TEXT` as
 * text, so without these a `timestamp()` column — typed `Date` — failed to
 * write a `Date` and read back a string.
 *
 * Stored format: `YYYY-MM-DD HH:MM:SS.SSS`, UTC — the shape SQLite's own
 * `CURRENT_TIMESTAMP` default writes (plus milliseconds), so stored values
 * compare and sort correctly against each other as text. `date()` columns
 * store `YYYY-MM-DD`.
 */

/** A `Date` as SQLite stores a timestamp. */
export const sqliteTimestamp = (d: Date): string =>
  d.toISOString().replace('T', ' ').replace('Z', '')

/** A `Date` as SQLite stores a calendar date. */
export const sqliteDate = (d: Date): string => d.toISOString().slice(0, 10)

/** Read a stored timestamp or date back as a `Date` (UTC unless it names a zone). */
export function fromSqliteDate(value: unknown): unknown {
  if (typeof value !== 'string') return value
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return new Date(`${value}T00:00:00Z`)
  const iso = value.replace(' ', 'T')
  const parsed = new Date(/(?:[zZ]|[+-]\d\d:?\d\d)$/.test(iso) ? iso : `${iso}Z`)
  return Number.isNaN(parsed.getTime()) ? value : parsed
}

/** Encoders for insert / update values, by column type. */
export const SQLITE_DATE_ENCODERS: Record<string, (v: unknown) => unknown> = {
  timestamp: (v) => (v instanceof Date ? sqliteTimestamp(v) : v),
  timestamptz: (v) => (v instanceof Date ? sqliteTimestamp(v) : v),
  date: (v) => (v instanceof Date ? sqliteDate(v) : v),
}

/** Decoders for result rows, by column type. */
export const SQLITE_DATE_DECODERS: Record<string, (v: unknown) => unknown> = {
  timestamp: fromSqliteDate,
  timestamptz: fromSqliteDate,
  date: fromSqliteDate,
}

/**
 * Parameters better-sqlite3 can't bind: a `Date` left among them — a
 * `where`, raw SQL — becomes a stored timestamp, and a boolean becomes
 * `1` / `0`, how SQLite stores one.
 */
export function encodeSqliteParameters(parameters: readonly unknown[]): readonly unknown[] {
  return parameters.some((p) => p instanceof Date || typeof p === 'boolean')
    ? parameters.map((p) =>
        p instanceof Date ? sqliteTimestamp(p) : typeof p === 'boolean' ? (p ? 1 : 0) : p,
      )
    : parameters
}

/**
 * A `boolean()` column reads back as `true` / `false`, not SQLite's `1` / `0`.
 * Any other integer a hand-written row holds reads as SQLite itself reads it
 * in `WHERE flag` — non-zero is true.
 */
export const fromSqliteBoolean = (v: unknown): unknown =>
  typeof v === 'number' || typeof v === 'bigint' ? Number(v) !== 0 : v
