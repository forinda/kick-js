import { ColumnBuilder } from './types'

// PG-only column types. Phantom T per builder so SchemaToKysely<S> can narrow
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
 * it up. The snapshot + emit pipeline learns about enum types in the
 * follow-up commit; for now adopters must run the
 * `CREATE TYPE <name> AS ENUM (...)` DDL manually before any column
 * referencing the type is created.
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

export function vector(dim?: number): ColumnBuilder<number[]> {
  return new ColumnBuilder<number[]>(dim === undefined ? 'vector' : `vector(${dim})`)
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
