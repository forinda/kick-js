import { ColumnBuilder, type GeneratedBrand } from './types'

// ── helpers ───────────────────────────────────────────────────────────────

/**
 * Type-level brand stamp. Runtime is identity; the cast attaches the
 * `GeneratedBrand` so `SchemaToKysely<S>` wraps the column in `Generated<T>`.
 * Used by serial-shaped constructors and the `defaultNow` / `defaultRandom`
 * subtype methods.
 */
function brandGenerated<C>(col: C): C & GeneratedBrand {
  return col as C & GeneratedBrand
}

function formatNumeric(base: string, precision?: number, scale?: number): string {
  if (precision === undefined) return base
  if (scale === undefined) return `${base}(${precision})`
  return `${base}(${precision}, ${scale})`
}

// ── auto-assigned identity columns (DB picks the value) ───────────────────

export function serial(): ColumnBuilder<number, false> & GeneratedBrand {
  return brandGenerated(new ColumnBuilder<number, false>('serial', { nullable: false }))
}

export function bigSerial(): ColumnBuilder<bigint, false> & GeneratedBrand {
  return brandGenerated(new ColumnBuilder<bigint, false>('bigserial', { nullable: false }))
}

export function smallSerial(): ColumnBuilder<number, false> & GeneratedBrand {
  return brandGenerated(new ColumnBuilder<number, false>('smallserial', { nullable: false }))
}

// ── numeric ───────────────────────────────────────────────────────────────

export function integer(): ColumnBuilder<number> {
  return new ColumnBuilder<number>('integer')
}

export function bigint(): ColumnBuilder<bigint> {
  return new ColumnBuilder<bigint>('bigint')
}

export function smallint(): ColumnBuilder<number> {
  return new ColumnBuilder<number>('smallint')
}

export function decimal(precision?: number, scale?: number): ColumnBuilder<string> {
  return new ColumnBuilder<string>(formatNumeric('decimal', precision, scale))
}

export function numeric(precision?: number, scale?: number): ColumnBuilder<string> {
  return new ColumnBuilder<string>(formatNumeric('numeric', precision, scale))
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
 * omits the column on insert.
 */
export class TimestampBuilder<TNullable extends boolean = true> extends ColumnBuilder<
  Date,
  TNullable
> {
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
 */
export class UuidBuilder<TNullable extends boolean = true> extends ColumnBuilder<
  string,
  TNullable
> {
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
 * The `_T` generic exists so adopters can declare their JSON shape:
 *
 *   meta: jsonb<{ tags: string[] }>()
 *
 * `SchemaToKysely<S>` then sees `ColumnBuilder<{ tags: string[] }>` and the
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
