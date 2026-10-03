import { CustomColumnBuilder } from '../../custom-type'
import { ColumnBuilder } from './types'

// PG-only column types. Phantom T per builder so SchemaToTypes<S> can narrow
// each column to a useful TS shape — strings for the text-y types, number[]
// for vector embeddings, etc.

/**
 * Declare a PostgreSQL ENUM type.
 *
 * @example
 * ```ts
 * export const taskStatus = pgEnum('task_status', 'todo', 'in_progress', 'done')
 *
 * export const tasks = table('tasks', {
 *   id: uuid().primaryKey().defaultRandom(),
 *   status: taskStatus().notNull().default('todo'),
 * })
 * ```
 *
 * The factory returns a column builder whose phantom type narrows to
 * the union of the declared values — `db.selectFrom('tasks').select('status')`
 * types `status: 'todo' | 'in_progress' | 'done'`.
 *
 * Schema-level state (the enum name + values) is attached to every
 * column the factory produces so introspection / drift / emit can pick
 * it up: `kick db generate` emits the `CREATE TYPE <name> AS ENUM (...)`
 * before the first table that uses it, and later value changes as
 * migrations.
 */
export interface PgEnumBuilder<TName extends string, TValues extends readonly string[]> {
  (): PgEnumColumnBuilder<TName, TValues>
  /** The SQL identifier — used by emit + drift detection. */
  readonly enumName: TName
  /** Allowed literal values, in declaration order. */
  readonly values: TValues
}

export class PgEnumColumnBuilder<
  TName extends string,
  TValues extends readonly string[],
> extends ColumnBuilder<TValues[number]> {
  /** The enum's SQL identifier — preserved for emit + drift detection. */
  readonly enumName: TName
  /** Allowed values — readonly to prevent mutation across columns. */
  readonly values: TValues

  constructor(enumName: TName, values: TValues) {
    // The SQL data type IS the enum identifier — `status task_status`,
    // not `status text` — so PG enforces the membership constraint.
    super(enumName)
    this.enumName = enumName
    this.values = values
  }
}

// Variadic rest forces TS to infer EACH value as its literal type, so
// `pgEnum('s', 'todo', 'done')` resolves to
// `PgEnumBuilder<'s', ['todo', 'done']>`. Without rest, an array
// literal stored in a variable would widen to `string[]` and the
// column phantom would collapse to plain `string`, defeating the
// entire point of the helper. Adopters with a pre-existing array
// can still spread it: `pgEnum('s', ...VALUES as const)`.
export function pgEnum<TName extends string, const TValues extends readonly [string, ...string[]]>(
  name: TName,
  ...values: TValues
): PgEnumBuilder<TName, TValues> {
  const factory = (): PgEnumColumnBuilder<TName, TValues> =>
    new PgEnumColumnBuilder<TName, TValues>(name, values)
  // Attach metadata to the factory itself so introspection that walks
  // `Object.values(schema)` can discover enum declarations even when
  // they're declared standalone (without a column reference).
  return Object.assign(factory, { enumName: name, values }) as PgEnumBuilder<TName, TValues>
}

export function tsvector(): ColumnBuilder<string> {
  return new ColumnBuilder<string>('tsvector')
}

/**
 * A built-in column whose values the driver doesn't convert, with the codecs
 * that do. Validators still know its type (a custom type reads as "any").
 * Codecs are shared module-level functions: they're keyed by column name, and
 * one instance per type keeps same-named columns in different tables quiet.
 */
export class PgCodecColumnBuilder<T> extends CustomColumnBuilder<T> {}

/** pgvector's text form is `[1,2,3]`: valid JSON both ways. */
const vectorToDriver = (v: number[]) => `[${v.join(',')}]`
const vectorFromDriver = (raw: unknown): number[] =>
  typeof raw === 'string' ? (JSON.parse(raw) as number[]) : (raw as number[])

function vectorColumn(base: string, dim?: number): PgCodecColumnBuilder<number[]> {
  return new PgCodecColumnBuilder<number[]>({
    dataType: () => (dim === undefined ? base : `${base}(${dim})`),
    toDriver: vectorToDriver,
    fromDriver: vectorFromDriver,
  })
}

/** A pgvector embedding (`vector(n)`), as `number[]`. Needs the `vector` extension. */
export function vector(dim?: number): PgCodecColumnBuilder<number[]> {
  return vectorColumn('vector', dim)
}

/** A half-precision pgvector embedding (`halfvec(n)`, pgvector 0.7+), as `number[]`. */
export function halfvec(dim?: number): PgCodecColumnBuilder<number[]> {
  return vectorColumn('halfvec', dim)
}

/** A point on a plane. */
export interface PgPoint {
  x: number
  y: number
}

const pointToDriver = (p: PgPoint) => `(${p.x},${p.y})`
const pointFromDriver = (raw: unknown): PgPoint => {
  if (typeof raw !== 'string') return raw as PgPoint // `pg` already parses it
  const [x, y] = raw
    .replace(/[()\s]/g, '')
    .split(',')
    .map(Number)
  return { x: x!, y: y! }
}

/** Postgres' geometric `point`, as `{ x, y }`. */
export function point(): PgCodecColumnBuilder<PgPoint> {
  return new PgCodecColumnBuilder<PgPoint>({
    dataType: () => 'point',
    toDriver: pointToDriver,
    fromDriver: pointFromDriver,
  })
}

/**
 * A PostGIS geometry: `geometry('Point', 4326)` → `geometry(Point, 4326)`.
 * The value is what PostGIS returns (hex EWKB) and takes text in (WKT or
 * EWKT, `'SRID=4326;POINT(36.8 -1.28)'`); convert with `ST_AsGeoJSON` /
 * `ST_GeomFromGeoJSON` in SQL. Needs the `postgis` extension.
 */
export function geometry(type?: string, srid?: number): ColumnBuilder<string> {
  const args = [type, srid].filter((a) => a !== undefined)
  return new ColumnBuilder<string>(args.length ? `geometry(${args.join(', ')})` : 'geometry')
}

/** A MAC address (`08:00:2b:01:02:03`). */
export function macaddr(): ColumnBuilder<string> {
  return new ColumnBuilder<string>('macaddr')
}

/** An EUI-64 MAC address. */
export function macaddr8(): ColumnBuilder<string> {
  return new ColumnBuilder<string>('macaddr8')
}

export function citext(): ColumnBuilder<string> {
  return new ColumnBuilder<string>('citext')
}

export function money(): ColumnBuilder<string> {
  return new ColumnBuilder<string>('money')
}

export function inet(): ColumnBuilder<string> {
  return new ColumnBuilder<string>('inet')
}

export function cidr(): ColumnBuilder<string> {
  return new ColumnBuilder<string>('cidr')
}

export function xml(): ColumnBuilder<string> {
  return new ColumnBuilder<string>('xml')
}
