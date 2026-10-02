import type { ColumnBuilder, ColumnRef, TypedColumnRefs } from './columns/types'
import type { CheckDecl, IndexDecl, PrimaryKeyDecl, TableConstraint } from './constraints'
import type { IndexSnapshot } from '../snapshot/types'
import { resolveSelfRefs } from './self-ref'

export type { ColumnRef }

export interface TableDecl<
  TName extends string = string,
  C extends Record<string, ColumnBuilder> = Record<string, ColumnBuilder>,
  TSchema extends string | undefined = string | undefined,
> {
  __isTable: true
  __name: TName
  __columns: C
  __indexes: IndexSnapshot[]
  /** Declared with `primaryKey(...)` — absent when columns carry `.primaryKey()`. */
  __primaryKey?: PrimaryKeyDecl
  __checks?: CheckDecl[]
  /**
   * Named SQL schema this table lives in, from `pgSchema('x').table(...)`.
   * `undefined` means the connection's default search_path (`public` on PG),
   * which is every table declared through the bare `table()` factory.
   *
   * PostgreSQL only — `assertSchemasSupported()` rejects a declared schema
   * on MySQL/SQLite at snapshot time rather than emitting subtly wrong DDL.
   */
  __schema?: TSchema
  /**
   * Validation rules a table form declared (`@Rule`, `rules`, `.column(k, b, rule)`),
   * applied by `insertSchema` / `selectSchema` / `updateSchema`. Not enumerable.
   */
  readonly __rules?: Readonly<Record<string, unknown>>
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
> = TableDecl<TName, C, TSchema> & TypedColumnRefs<C>

type ConstraintBuilder<C extends Record<string, ColumnBuilder>> = (
  refs: TypedColumnRefs<C>,
) => Record<string, TableConstraint>

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
  declared: C,
  constraints: ConstraintBuilder<C> | undefined,
  schema: TSchema,
): TableRefs<TName, C, TSchema> {
  const selfRefs: Record<string, ColumnRef> = {}
  const columns = resolveSelfRefs(name, declared, selfRefs)
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

  Object.assign(selfRefs, refs)

  if (constraints) {
    const declared = Object.values(constraints(refs))
    decl.__indexes = declared.filter((c): c is IndexDecl => '__index' in c).map((c) => c.__index)
    const checks = declared.filter((c): c is CheckDecl => 'kind' in c && c.kind === 'check')
    if (checks.length > 0) decl.__checks = checks
    const keys = declared.filter((c): c is PrimaryKeyDecl => 'kind' in c && c.kind === 'primaryKey')
    if (keys.length > 1) {
      throw new Error(`kickjs-db: table '${name}' declares primaryKey() more than once`)
    }
    if (keys[0]) {
      const flagged = Object.entries(columns)
        .filter(([, b]) => b.__state().primaryKey)
        .map(([k]) => k)
      if (flagged.length > 0) {
        throw new Error(
          `kickjs-db: table '${name}' declares its primary key twice — primaryKey() and ` +
            `.primaryKey() on ${flagged.join(', ')}. Keep one.`,
        )
      }
      const unknown = keys[0].columns.filter((c) => !(c in columns))
      if (unknown.length > 0 || keys[0].columns.length === 0) {
        throw new Error(`kickjs-db: table '${name}' primaryKey() needs columns of this table`)
      }
      decl.__primaryKey = keys[0]
    }
  }

  return Object.assign(decl, refs)
}

/**
 * The table a schema-barrel export stands for: a table itself, or a class
 * form carrying one as `static table` (`class User extends TableBase(...)`).
 * Everything that scans a schema for tables goes through this, so exporting
 * the class is enough — no separate `export const users = User.table`.
 */
export function unwrapTable(value: unknown): TableDecl | undefined {
  if (value && typeof value === 'object' && (value as TableDecl).__isTable === true) {
    return value as TableDecl
  }
  if (typeof value === 'function') {
    const inner = (value as { table?: unknown }).table
    if (inner && typeof inner === 'object' && (inner as TableDecl).__isTable === true) {
      return inner as TableDecl
    }
  }
  return undefined
}
