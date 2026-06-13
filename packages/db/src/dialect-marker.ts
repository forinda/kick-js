/**
 * Explicit dialect tagging for `createDbClient`'s dialect detection.
 *
 * The historical `detectDialect` inspected Kysely ctor names
 * (`/Postgres/i.test(...)`) with a silent fallback to `'sqlite'` — so a
 * hand-rolled or future Kysely dialect whose ctor name didn't match
 * `Postgres`/`Mysql` was silently treated as SQLite, emitting the wrong
 * JSON aggregation primitives at compile time.
 *
 * KickJS's own dialect factories (`pgDialect` / `mysqlDialect` /
 * `sqliteDialect`) now stamp this marker, so detection is exact for the
 * supported path. The ctor-name heuristic remains as the fallback for
 * raw Kysely dialects an adopter constructs directly.
 *
 * `Symbol.for` so the marker is shared across module-identity boundaries
 * (multiple copies of `@forinda/kickjs-db`).
 */
export const KICK_DIALECT: unique symbol = Symbol.for('@forinda/kickjs-db/dialect') as never

export type DialectTag = 'postgres' | 'mysql' | 'sqlite'

/** Stamp a Kysely dialect object with its KickJS dialect tag (non-enumerable). */
export function markDialect<T extends object>(dialect: T, tag: DialectTag): T {
  Object.defineProperty(dialect, KICK_DIALECT, {
    value: tag,
    enumerable: false,
    configurable: true,
    writable: false,
  })
  return dialect
}

/** Read the KickJS dialect tag off a dialect, or `undefined` when unmarked. */
export function readDialectMark(dialect: object): DialectTag | undefined {
  return (dialect as Record<symbol, unknown>)[KICK_DIALECT] as DialectTag | undefined
}
