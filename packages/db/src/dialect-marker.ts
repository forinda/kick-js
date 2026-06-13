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
// Typed as plain `symbol` (no annotation, no cast). `Symbol.for` can't
// produce a `unique symbol` — TS requires that type to come from a
// direct `Symbol()`/`Symbol.for()` const initializer with no
// intervening cast, so any `: unique symbol` annotation here forces an
// unsafe cast (`as never` / `as unknown as unique symbol`). We only use
// this value as a computed property key, where `symbol` is sufficient.
export const KICK_DIALECT = Symbol.for('@forinda/kickjs-db/dialect')

export type DialectTag = 'postgres' | 'mysql' | 'sqlite'

const DIALECT_TAGS: ReadonlySet<string> = new Set<DialectTag>(['postgres', 'mysql', 'sqlite'])

/** Type guard — `true` when `value` is a supported dialect tag. */
export function isDialectTag(value: unknown): value is DialectTag {
  return typeof value === 'string' && DIALECT_TAGS.has(value)
}

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

/**
 * Read the KickJS dialect tag off a dialect, or `undefined` when
 * unmarked. A garbage value (the marker is a global `Symbol.for`, so a
 * rogue stamp is possible) is rejected — `undefined` falls the caller
 * back to ctor-name detection rather than an impossible dialect state.
 */
export function readDialectMark(dialect: object): DialectTag | undefined {
  const raw = (dialect as Record<symbol, unknown>)[KICK_DIALECT]
  return isDialectTag(raw) ? raw : undefined
}
