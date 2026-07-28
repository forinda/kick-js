import type { ColumnBuilder, ColumnRef } from './columns/types'
import type { IndexDecl } from './constraints'
import { buildTable, type TableDecl } from './table'

/**
 * PostgreSQL named-schema namespace.
 *
 * ```ts
 * const billing = pgSchema('billing')
 *
 * const invoices = billing.table('invoices', {
 *   id: uuid().primaryKey().defaultRandom(),
 *   total: numeric().notNull(),
 * })
 * ```
 *
 * Emits `CREATE SCHEMA IF NOT EXISTS "billing"` ahead of the tables that need
 * it, qualifies every generated statement (`"billing"."invoices"`), and keys
 * the row type as `KickDbSchema['billing.invoices']` so Kysely resolves the
 * qualified table without a `withSchema()` call.
 *
 * Tables declared through the bare `table()` factory are untouched: no schema
 * field, bare identifiers, same snapshot bytes and migration hashes as before.
 *
 * PostgreSQL only. A schema is a true namespace only on PG — on MySQL the
 * word means "database" and on SQLite it means an `ATTACH` alias, both of
 * which have different lifecycles than `CREATE SCHEMA`. Declaring one and
 * then diffing against MySQL/SQLite throws rather than emitting DDL that
 * looks right and means something else.
 */
export interface PgSchema<TSchema extends string | undefined = string | undefined> {
  readonly __isPgSchema: true
  /** The schema name as declared, e.g. `billing`. */
  readonly name: string

  table<TName extends string, C extends Record<string, ColumnBuilder>>(
    name: TName,
    columns: C,
    constraints?: (refs: { [K in keyof C]: ColumnRef }) => Record<string, IndexDecl>,
  ): TableDecl<TName, C, TSchema> & { [K in keyof C]: ColumnRef }
}

/**
 * `public` resolves to "no schema" rather than to itself.
 *
 * PG creates `public` for every database and puts it on the default
 * search_path, so `pgSchema('public').table('users', …)` and
 * `table('users', …)` name the same physical table. If the former stamped
 * `schema: 'public'`, its snapshot key would be `public.users` while the
 * latter's is `users` — the diff engine would read that as "drop `users`,
 * create `public.users`" and emit a DROP TABLE. Collapsing to `undefined`
 * keeps the two spellings interchangeable, and the conditional return type
 * below keeps the static key in step with the runtime one.
 */
type EffectiveSchema<TName extends string> = TName extends 'public' ? undefined : TName

/** Reject names that would need quoting gymnastics or inject into DDL. */
const SCHEMA_NAME = /^[A-Za-z_][A-Za-z0-9_$]*$/

/**
 * Declare a PostgreSQL schema namespace. See {@link PgSchema}.
 *
 * `pgSchema('public')` is accepted and collapses to "no schema" — see
 * {@link EffectiveSchema} for why that matters.
 */
export function pgSchema<TName extends string>(name: TName): PgSchema<EffectiveSchema<TName>> {
  if (!SCHEMA_NAME.test(name)) {
    throw new Error(
      `pgSchema: invalid schema name ${JSON.stringify(name)}. ` +
        `Expected an unquoted PostgreSQL identifier matching ${SCHEMA_NAME.source}.`,
    )
  }
  const effective = (name === 'public' ? undefined : name) as EffectiveSchema<TName>

  return {
    __isPgSchema: true,
    name,
    table<TName2 extends string, C extends Record<string, ColumnBuilder>>(
      tableName: TName2,
      columns: C,
      constraints?: (refs: { [K in keyof C]: ColumnRef }) => Record<string, IndexDecl>,
    ) {
      return buildTable(tableName, columns, constraints, effective)
    },
  }
}

export function isPgSchema(value: unknown): value is PgSchema<string> {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { __isPgSchema?: unknown }).__isPgSchema === true
  )
}
