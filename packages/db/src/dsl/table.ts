import type { ColumnBuilder, ColumnRef } from './columns/types'
import type { IndexDecl } from './constraints'

export type { ColumnRef }

export interface TableDecl<
  TName extends string = string,
  C extends Record<string, ColumnBuilder> = Record<string, ColumnBuilder>,
  TSchema extends string | undefined = string | undefined,
> {
  __isTable: true
  __name: TName
  __columns: C
  __indexes: IndexDecl[]
  /**
   * Named SQL schema this table lives in, from `pgSchema('x').table(...)`.
   * `undefined` means the connection's default search_path (`public` on PG),
   * which is every table declared through the bare `table()` factory.
   *
   * PostgreSQL only — `assertSchemasSupported()` rejects a declared schema
   * on MySQL/SQLite at snapshot time rather than emitting subtly wrong DDL.
   */
  __schema?: TSchema
}

/**
 * Fully-qualified name used as the snapshot key, the Kysely table key, and
 * the emitted identifier. `quoteIdent` splits on `.`, so `billing.invoices`
 * renders as `"billing"."invoices"` with no further work.
 *
 * Unqualified tables keep their bare name, so every pre-schema snapshot,
 * migration hash, and `KickDbSchema` key is byte-identical to before.
 */
export type QualifiedName<
  TName extends string,
  TSchema extends string | undefined,
> = TSchema extends string ? `${TSchema}.${TName}` : TName

/** Runtime counterpart of {@link QualifiedName}. */
export function qualifiedTableName(decl: {
  __name: string
  __schema?: string | undefined
}): string {
  return decl.__schema ? `${decl.__schema}.${decl.__name}` : decl.__name
}

type TableRefs<
  TName extends string,
  C extends Record<string, ColumnBuilder>,
  TSchema extends string | undefined = undefined,
> = TableDecl<TName, C, TSchema> & {
  [K in keyof C]: ColumnRef
}

type ConstraintBuilder<C extends Record<string, ColumnBuilder>> = (refs: {
  [K in keyof C]: ColumnRef
}) => Record<string, IndexDecl>

/**
 * Declare a typed table. The `TName extends string` generic narrows to the
 * literal table name so `SchemaToTypes<S>` can index by it without losing
 * the constant — `table('users', …)` widens to `TableDecl<'users', …>`,
 * not `TableDecl<string, …>`.
 */
export function table<TName extends string, C extends Record<string, ColumnBuilder>>(
  name: TName,
  columns: C,
  constraints?: ConstraintBuilder<C>,
): TableRefs<TName, C> {
  return buildTable(name, columns, constraints, undefined)
}

/**
 * Shared table constructor. `table()` passes `schema: undefined`;
 * `pgSchema('x').table()` passes the schema name through.
 */
export function buildTable<
  TName extends string,
  C extends Record<string, ColumnBuilder>,
  TSchema extends string | undefined,
>(
  name: TName,
  columns: C,
  constraints: ConstraintBuilder<C> | undefined,
  schema: TSchema,
): TableRefs<TName, C, TSchema> {
  const decl: TableDecl<TName, C, TSchema> = {
    __isTable: true,
    __name: name,
    __columns: columns,
    __indexes: [],
  }
  // Only stamp the field when a schema was declared, so unqualified tables
  // serialize identically to before this feature existed.
  if (schema !== undefined) decl.__schema = schema

  // Column refs carry the QUALIFIED owner name. `extractSnapshot` reads it
  // straight into `ForeignKeySnapshot.refTable`, so a foreign key pointing
  // at a schema-qualified table emits `REFERENCES "billing"."invoices"`
  // without the FK path needing to know schemas exist.
  const owner = schema !== undefined ? `${schema}.${name}` : name

  const refs = {} as { [K in keyof C]: ColumnRef }
  for (const [key, builder] of Object.entries(columns) as [keyof C, ColumnBuilder][]) {
    refs[key] = {
      __tableName: owner,
      __name: key as string,
      __builder: builder,
      __state: () => builder.__state(),
    }
  }

  if (constraints) {
    const declared = constraints(refs)
    decl.__indexes = Object.values(declared)
  }

  return Object.assign(decl, refs)
}
