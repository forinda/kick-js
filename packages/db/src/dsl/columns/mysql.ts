import { ColumnBuilder } from './types'

/**
 * A MySQL `ENUM`: `status: mysqlEnum('active', 'archived')`, typed as the
 * union of its values. The values keep their case.
 */
export function mysqlEnum<const V extends readonly [string, ...string[]]>(
  ...values: V
): ColumnBuilder<V[number]> {
  const quoted = values.map((v) => `'${v.replace(/'/g, "''")}'`).join(',')
  return new ColumnBuilder<V[number]>(`enum(${quoted})`)
}

/** A 1-byte integer (`TINYINT`, -128…127; 0…255 with {@link unsigned}). */
export function tinyint(): ColumnBuilder<number> {
  return new ColumnBuilder<number>('tinyint')
}

/** A 3-byte integer (`MEDIUMINT`). */
export function mediumint(): ColumnBuilder<number> {
  return new ColumnBuilder<number>('mediumint')
}

/**
 * `DATETIME`, with fractional seconds when given: `datetime(3)`. Unlike
 * `TIMESTAMP` it isn't converted to UTC, and it holds years 1000–9999.
 */
export function datetime(fsp?: number): ColumnBuilder<Date> {
  return new ColumnBuilder<Date>(fsp === undefined ? 'datetime' : `datetime(${fsp})`)
}

/** MySQL's spelling of each integer column type kick/db has. */
const INTEGER_TYPES: Record<string, string> = {
  tinyint: 'tinyint',
  smallint: 'smallint',
  mediumint: 'mediumint',
  integer: 'int',
  int: 'int',
  bigint: 'bigint',
}

/**
 * Make an integer column `UNSIGNED`: `unsigned(integer())`,
 * `unsigned(bigint({ mode: 'bigint' }))`. Its type and chain stay as they were.
 */
export function unsigned<
  C extends ColumnBuilder<number> | ColumnBuilder<bigint> | ColumnBuilder<string>,
>(column: C): C {
  const state = (column as unknown as { state: { type: string } }).state
  const base = INTEGER_TYPES[state.type]
  if (!base) {
    throw new Error(`unsigned(): ${state.type} isn't an integer column`)
  }
  state.type = `${base} unsigned`
  return column
}
