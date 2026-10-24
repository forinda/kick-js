import { ColumnBuilder, type GeneratedBrand, type NotNullBrand } from './types'

// ── helpers ───────────────────────────────────────────────────────────────

/**
 * Type-level brand stamps. Runtime is identity; the cast attaches the
 * relevant brand so `SchemaToTypes<S>` reads them per column.
 */
function brandGenerated<C>(col: C): C & GeneratedBrand {
  return col as C & GeneratedBrand
}

function brandNotNull<C>(col: C): C & NotNullBrand {
  return col as C & NotNullBrand
}

function formatNumeric(base: string, precision?: number, scale?: number): string {
  if (precision === undefined) return base
  if (scale === undefined) return `${base}(${precision})`
  return `${base}(${precision}, ${scale})`
}

// ── auto-assigned identity columns (DB picks the value) ───────────────────
//
// Auto-identity columns are always NOT NULL by SQL semantics, so we stamp
// both NotNullBrand (drop the `| null`) and GeneratedBrand (wrap in
// Generated<T>) at the constructor.

/**
 * An auto-numbered integer the database assigns: `serial` on Postgres,
 * `INT AUTO_INCREMENT` on MySQL, `INTEGER … AUTOINCREMENT` on SQLite.
 * Not null, and optional on insert.
 *
 * @example
 * id: serial().primaryKey()
 */
export function serial(): ColumnBuilder<number> & GeneratedBrand & NotNullBrand {
  return brandNotNull(brandGenerated(new ColumnBuilder<number>('serial', { nullable: false })))
}

/** How `bigint` / `numeric` values are read back, and the type they get. */
export interface NumberModes {
  bigint: bigint
  number: number
  string: string
}

/**
 * {@link serial} as a 64-bit integer (`bigserial`, MySQL `BIGINT`), typed `bigint`.
 *
 * @example
 * id: bigSerial().primaryKey()
 */
export function bigSerial(): ColumnBuilder<bigint> & GeneratedBrand & NotNullBrand {
  return brandNotNull(brandGenerated(new ColumnBuilder<bigint>('bigserial', { nullable: false })))
}

/** {@link serial} as a 16-bit integer (`smallserial`, MySQL `SMALLINT`). */
export function smallSerial(): ColumnBuilder<number> & GeneratedBrand & NotNullBrand {
  return brandNotNull(brandGenerated(new ColumnBuilder<number>('smallserial', { nullable: false })))
}

// ── numeric ───────────────────────────────────────────────────────────────

/**
 * A 32-bit integer (`integer`; MySQL `INT`), typed `number`.
 *
 * @example
 * stock: integer().notNull().default(0)
 */
export function integer(): ColumnBuilder<number> {
  return new ColumnBuilder<number>('integer')
}

/**
 * A 64-bit integer. Drivers return it differently (`pg` a string,
 * better-sqlite3 a number), so pick how it reads back with `mode`:
 * `'bigint'` (exact), `'number'` (safe up to 2^53) or `'string'`. Without
 * `mode` the driver's value is returned, typed `bigint`.
 *
 * @example
 * views: bigint({ mode: 'number' }).notNull().default(0)
 */
export function bigint(): ColumnBuilder<bigint>
export function bigint<M extends keyof NumberModes>(options: {
  mode: M
}): ColumnBuilder<NumberModes[M]>
export function bigint(options?: { mode: keyof NumberModes }): ColumnBuilder<unknown> {
  return new ColumnBuilder('bigint', options ? { mode: options.mode } : {})
}

/** A 16-bit integer (`smallint`), typed `number`. */
export function smallint(): ColumnBuilder<number> {
  return new ColumnBuilder<number>('smallint')
}

/**
 * An optimistic-locking counter: an integer, not null, starting at 0, that
 * every update increments. Read it with the row, then update
 * `.where('version', '=', read)` — no row updated means someone else changed
 * it first.
 *
 * @example
 * version: version()
 */
export function version(): ColumnBuilder<number> & NotNullBrand & GeneratedBrand {
  const col = integer().notNull().default(0) as ColumnBuilder<number> &
    NotNullBrand &
    GeneratedBrand
  ;(col as unknown as { state: { managed: string } }).state.managed = 'version'
  return col
}

type DecimalMode = { mode: 'number' | 'string' }

/**
 * An exact decimal, read back as a string by default so no precision is lost.
 * `{ mode: 'number' }` reads it as a JS number: exact up to 15 significant
 * digits, which validators enforce on input (more is refused, not rounded).
 *
 * @example
 * price: decimal(12, 2).notNull() // '19.99'
 */
export function decimal(precision?: number, scale?: number): ColumnBuilder<string>
export function decimal<M extends DecimalMode['mode']>(
  precision: number | undefined,
  scale: number | undefined,
  options: { mode: M },
): ColumnBuilder<NumberModes[M]>
export function decimal(
  precision?: number,
  scale?: number,
  options?: DecimalMode,
): ColumnBuilder<unknown> {
  return new ColumnBuilder(
    formatNumeric('decimal', precision, scale),
    options ? { mode: options.mode } : {},
  )
}

/** Same as {@link decimal}. */
export function numeric(precision?: number, scale?: number): ColumnBuilder<string>
export function numeric<M extends DecimalMode['mode']>(
  precision: number | undefined,
  scale: number | undefined,
  options: { mode: M },
): ColumnBuilder<NumberModes[M]>
export function numeric(
  precision?: number,
  scale?: number,
  options?: DecimalMode,
): ColumnBuilder<unknown> {
  return new ColumnBuilder(
    formatNumeric('numeric', precision, scale),
    options ? { mode: options.mode } : {},
  )
}

/** A 4-byte float (`real`; MySQL `FLOAT`), typed `number`. Inexact: use {@link decimal} for money. */
export function real(): ColumnBuilder<number> {
  return new ColumnBuilder<number>('real')
}

/** An 8-byte float (`double precision`; MySQL `DOUBLE`), typed `number`. Inexact: use {@link decimal} for money. */
export function doublePrecision(): ColumnBuilder<number> {
  return new ColumnBuilder<number>('double precision')
}

// ── string-shaped ─────────────────────────────────────────────────────────

/**
 * Text up to `length` characters (`varchar(n)`, default 255), typed `string`.
 * SQLite stores it as `TEXT` and doesn't enforce the length.
 *
 * @example
 * email: varchar(320).notNull().unique()
 */
export function varchar(length = 255): ColumnBuilder<string> {
  return new ColumnBuilder<string>(`varchar(${length})`)
}

/** Fixed-length text (`char(n)`, default 1), typed `string`. Postgres and MySQL pad it with spaces. */
export function char(length = 1): ColumnBuilder<string> {
  return new ColumnBuilder<string>(`char(${length})`)
}

/**
 * Text of any length (`text`), typed `string`.
 *
 * @example
 * body: text().notNull()
 */
export function text(): ColumnBuilder<string> {
  return new ColumnBuilder<string>('text')
}

// ── boolean ───────────────────────────────────────────────────────────────

/**
 * `true` / `false` (`boolean`; MySQL `TINYINT(1)`, SQLite `INTEGER`), typed
 * `boolean`.
 *
 * @example
 * active: boolean().notNull().default(true)
 */
export function boolean(): ColumnBuilder<boolean> {
  return new ColumnBuilder<boolean>('boolean')
}

// ── date / time ───────────────────────────────────────────────────────────

/**
 * Subtype builder so `defaultNow()` can mark the resulting column as
 * generated — when the DB will fill in `CURRENT_TIMESTAMP` if the adopter
 * omits the column on insert. Returns `this & GeneratedBrand` so the
 * subclass identity is preserved through the chain.
 */
export class TimestampBuilder extends ColumnBuilder<Date> {
  constructor(typeName: string = 'timestamp') {
    super(typeName)
  }

  /** Default to the current time (`CURRENT_TIMESTAMP`); optional on insert. */
  defaultNow(): this & GeneratedBrand {
    this.state.default = 'CURRENT_TIMESTAMP'
    return brandGenerated(this)
  }
}

/** Fractional-second digits a time type stores: 0–6. */
export interface TimeOptions {
  precision?: number
}

/** `name(p)`, or `name` without a precision. */
function withPrecision(name: string, opts?: TimeOptions): string {
  const p = opts?.precision
  if (p === undefined) return name
  if (!Number.isInteger(p) || p < 0 || p > 6) {
    throw new Error(
      `kickjs-db: ${name}({ precision: ${p} }) — precision is a whole number from 0 to 6`,
    )
  }
  return `${name}(${p})`
}

/**
 * A date and time without a zone (`timestamp`), typed `Date`.
 * `{ precision: 3 }` keeps milliseconds; without one, the database's default.
 *
 * @example
 * updatedAt: timestamp().notNull().defaultNow().onUpdateNow()
 */
export function timestamp(opts?: TimeOptions): TimestampBuilder {
  return new TimestampBuilder(withPrecision('timestamp', opts))
}

/**
 * A point in time with its zone (`timestamptz`; MySQL `TIMESTAMP`), typed
 * `Date`. `{ precision: 3 }` keeps milliseconds.
 *
 * @example
 * createdAt: timestamptz().notNull().defaultNow()
 */
export function timestamptz(opts?: TimeOptions): TimestampBuilder {
  return new TimestampBuilder(withPrecision('timestamptz', opts))
}

/** A calendar date without a time (`date`), typed `Date`. */
export function date(): ColumnBuilder<Date> {
  return new ColumnBuilder<Date>('date')
}

/** A time of day (`time`), typed `string` (`'14:30:00'`). `{ precision: 3 }` keeps milliseconds. */
export function time(opts?: TimeOptions): ColumnBuilder<string> {
  return new ColumnBuilder<string>(withPrecision('time', opts))
}

/** A duration (`interval`, Postgres), typed `string` as the driver returns it (`'1 day'`). */
export function interval(): ColumnBuilder<string> {
  return new ColumnBuilder<string>('interval')
}

// ── identity-shaped (uuid) ────────────────────────────────────────────────

/**
 * Subtype builder so `defaultRandom()` can mark the resulting column as
 * generated — when the DB fills in `gen_random_uuid()` for omitted columns.
 * Returns `this & GeneratedBrand` so chaining works in either order:
 *   uuid().defaultRandom().primaryKey()
 *   uuid().primaryKey().defaultRandom()  ← also works
 */
export class UuidBuilder extends ColumnBuilder<string> {
  constructor() {
    super('uuid')
  }

  /** Default to a random UUID the database generates; optional on insert. */
  defaultRandom(): this & GeneratedBrand {
    this.state.default = 'gen_random_uuid()'
    return brandGenerated(this)
  }
}

/**
 * A UUID (`uuid`; MySQL `CHAR(36)`, SQLite `TEXT`), typed `string`.
 * `.defaultRandom()` lets the database generate one.
 *
 * @example
 * id: uuid().primaryKey().defaultRandom()
 */
export function uuid(): UuidBuilder {
  return new UuidBuilder()
}

// ── structured / binary ───────────────────────────────────────────────────

/**
 * The `T` generic exists so adopters can declare their JSON shape:
 *
 *   meta: jsonb<{ tags: string[] }>()
 *
 * `SchemaToTypes<S>` then sees `ColumnBuilder<{ tags: string[] }>` and the
 * row type narrows to `{ tags: string[] } | null`.
 */
export function json<T = unknown>(): ColumnBuilder<T> {
  return new ColumnBuilder<T>('json')
}

/**
 * Binary JSON (`jsonb`; `JSON` on MySQL, `TEXT` on SQLite), typed `T`.
 * Name the shape with the generic.
 *
 * @example
 * meta: jsonb<{ tags: string[] }>().notNull().default({ tags: [] })
 */
export function jsonb<T = unknown>(): ColumnBuilder<T> {
  return new ColumnBuilder<T>('jsonb')
}

/** Raw bytes (`bytea`; `BLOB` on MySQL and SQLite), typed `Uint8Array`. */
export function bytea(): ColumnBuilder<Uint8Array> {
  return new ColumnBuilder<Uint8Array>('bytea')
}
