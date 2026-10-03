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

export function serial(): ColumnBuilder<number> & GeneratedBrand & NotNullBrand {
  return brandNotNull(brandGenerated(new ColumnBuilder<number>('serial', { nullable: false })))
}

/** How `bigint` / `numeric` values are read back, and the type they get. */
export interface NumberModes {
  bigint: bigint
  number: number
  string: string
}

export function bigSerial(): ColumnBuilder<bigint> & GeneratedBrand & NotNullBrand {
  return brandNotNull(brandGenerated(new ColumnBuilder<bigint>('bigserial', { nullable: false })))
}

export function smallSerial(): ColumnBuilder<number> & GeneratedBrand & NotNullBrand {
  return brandNotNull(brandGenerated(new ColumnBuilder<number>('smallserial', { nullable: false })))
}

// ── numeric ───────────────────────────────────────────────────────────────

export function integer(): ColumnBuilder<number> {
  return new ColumnBuilder<number>('integer')
}

/**
 * A 64-bit integer. Drivers return it differently (`pg` a string,
 * better-sqlite3 a number), so pick how it reads back with `mode`:
 * `'bigint'` (exact), `'number'` (safe up to 2^53) or `'string'`. Without
 * `mode` the driver's value is returned, typed `bigint`.
 */
export function bigint(): ColumnBuilder<bigint>
export function bigint<M extends keyof NumberModes>(options: {
  mode: M
}): ColumnBuilder<NumberModes[M]>
export function bigint(options?: { mode: keyof NumberModes }): ColumnBuilder<unknown> {
  return new ColumnBuilder('bigint', options ? { mode: options.mode } : {})
}

export function smallint(): ColumnBuilder<number> {
  return new ColumnBuilder<number>('smallint')
}

/**
 * An optimistic-locking counter: an integer, not null, starting at 0, that
 * every update increments. Read it with the row, then update
 * `.where('version', '=', read)` — no row updated means someone else changed
 * it first.
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
 * `{ mode: 'number' }` reads it as a JS number (fine for money in cents-scale
 * amounts, lossy past ~15 significant digits).
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

export function real(): ColumnBuilder<number> {
  return new ColumnBuilder<number>('real')
}

export function doublePrecision(): ColumnBuilder<number> {
  return new ColumnBuilder<number>('double precision')
}

// ── string-shaped ─────────────────────────────────────────────────────────

export function varchar(length = 255): ColumnBuilder<string> {
  return new ColumnBuilder<string>(`varchar(${length})`)
}

export function char(length = 1): ColumnBuilder<string> {
  return new ColumnBuilder<string>(`char(${length})`)
}

export function text(): ColumnBuilder<string> {
  return new ColumnBuilder<string>('text')
}

// ── boolean ───────────────────────────────────────────────────────────────

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

  defaultNow(): this & GeneratedBrand {
    this.state.default = 'CURRENT_TIMESTAMP'
    return brandGenerated(this)
  }
}

export function timestamp(): TimestampBuilder {
  return new TimestampBuilder('timestamp')
}

export function timestamptz(): TimestampBuilder {
  return new TimestampBuilder('timestamptz')
}

export function date(): ColumnBuilder<Date> {
  return new ColumnBuilder<Date>('date')
}

export function time(): ColumnBuilder<string> {
  return new ColumnBuilder<string>('time')
}

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

  defaultRandom(): this & GeneratedBrand {
    this.state.default = 'gen_random_uuid()'
    return brandGenerated(this)
  }
}

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

export function jsonb<T = unknown>(): ColumnBuilder<T> {
  return new ColumnBuilder<T>('jsonb')
}

export function bytea(): ColumnBuilder<Uint8Array> {
  return new ColumnBuilder<Uint8Array>('bytea')
}
