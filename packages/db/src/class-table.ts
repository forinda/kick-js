/**
 * PROOF OF CONCEPT — not exported from the package.
 *
 * A class form for kick/db tables, built on the same column builders:
 *
 *   @Table('users')
 *   class User {
 *     @Column(uuid().primaryKey().defaultRandom()) id!: string
 *     @Column(varchar(120).notNull(), { format: 'email' }) email!: string
 *     @Column(text()) bio!: string | null
 *   }
 *
 *   export const users = tableOf(User)   // the TableDecl `table('users', {...})` builds
 *
 * `tableOf` hands the collected builders to `table()`, so snapshot / diff /
 * migrate, the Kysely client and `insertSchema` see an ordinary table — the
 * class is a second way to write it, not a second model.
 *
 * `@Column` also checks the property's declared type against the builder:
 * `@Column(varchar().notNull()) email!: string | null` is a type error, as is
 * `@Column(integer()) age!: string`.
 */
import type { ColumnRule, SchemaLike } from './schema'
import { ColumnBuilder as ColumnBuilderClass } from './dsl/columns/types'
import type { ColumnBuilder, NotNullBrand } from './dsl/columns/types'
import type { IndexDecl } from './dsl/constraints'
import { pgSchema } from './dsl/pg-schema'
import { table, type ColumnRef, type TableDecl } from './dsl/table'

const COLUMNS = Symbol.for('@forinda/kickjs-db/class-columns')
const RULES = Symbol.for('@forinda/kickjs-db/class-rules')
const NAME = Symbol.for('@forinda/kickjs-db/class-table-name')
const TABLE = Symbol.for('@forinda/kickjs-db/class-table')
const SCHEMA = Symbol.for('@forinda/kickjs-db/class-table-schema')

type Ctor = abstract new (...args: never[]) => unknown

interface ClassMeta {
  [COLUMNS]?: Record<string, ColumnBuilder>
  [RULES]?: Record<string, ColumnRule | SchemaLike>
  [NAME]?: string
  [TABLE]?: TableDecl
  [SCHEMA]?: string
}

/** What a property holding this column may be declared as. */
type ColumnValue<B> =
  B extends ColumnBuilder<infer T> ? (B extends NotNullBrand ? T : T | null) : never

/**
 * Name the table a class declares. `@Table`, not `@Schema`: in kick/db a
 * schema is a Postgres namespace (`pgSchema`) or a request validator
 * (`insertSchema`), and this is neither.
 */
export function Table(name: string, options: { schema?: string } = {}) {
  return (target: Ctor): void => {
    const meta = target as unknown as ClassMeta
    meta[NAME] = name
    meta[SCHEMA] = options.schema
  }
}

/** A table in a Postgres schema (`pgSchema(schema).table(...)`), or a bare table. */
function build(
  name: string,
  columns: Record<string, ColumnBuilder>,
  schema?: string,
  constraints?: (refs: never) => Record<string, IndexDecl>,
) {
  return schema
    ? pgSchema(schema).table(name, columns, constraints as never)
    : table(name, columns, constraints as never)
}

/**
 * Declare a column with a kick/db builder. `rule` adds the validation a SQL
 * type can't express; `insertSchema(tableOf(C), { columns: rulesOf(C) })`
 * applies it.
 */
export function Column<B extends ColumnBuilder>(builder: B, rule?: ColumnRule | SchemaLike) {
  // The prototype parameter is typed from the property: a declared type the
  // column can't hold fails to compile at the decorator.
  return <K extends string>(prototype: { [P in K]: ColumnValue<B> }, key: K): void => {
    const ctor = (prototype as object).constructor as unknown as ClassMeta
    // Own copies, so a subclass never writes into its parent's columns.
    if (!Object.hasOwn(ctor, COLUMNS)) ctor[COLUMNS] = { ...ctor[COLUMNS] }
    if (!Object.hasOwn(ctor, RULES)) ctor[RULES] = { ...ctor[RULES] }
    ctor[COLUMNS]![key] = builder
    if (rule) ctor[RULES]![key] = rule
  }
}

/** The table a `@Table` class declares — built once, then the same object every call. */
export function tableOf<C extends Ctor>(
  cls: C,
): TableDecl<string, Record<keyof InstanceType<C> & string, ColumnBuilder>> &
  Record<keyof InstanceType<C> & string, ColumnRef> {
  const meta = cls as unknown as ClassMeta
  if (!Object.hasOwn(meta, TABLE)) {
    const name = meta[NAME]
    if (!name) throw new Error(`${cls.name} has no @Table('<table>') decorator`)
    const columns = meta[COLUMNS]
    if (!columns || Object.keys(columns).length === 0) {
      throw new Error(`${cls.name} declares no @Column properties`)
    }
    meta[TABLE] = build(name, columns, meta[SCHEMA]) as TableDecl
  }
  return meta[TABLE] as never
}

/** The `@Column(..., rule)` rules, in the shape `insertSchema`'s `columns` option takes. */
export function rulesOf(cls: Ctor): Record<string, ColumnRule | SchemaLike> {
  const meta = cls as unknown as ClassMeta & Record<symbol, Record<string, ColumnRule | SchemaLike>>
  return { ...meta[RULES], ...meta[Symbol.for('@forinda/kickjs-db/class-field-rules')] }
}

// ── Variant B: builders as field initializers ───────────────────────────
//
//   class Users {
//     static readonly tableName = 'users'
//     static readonly schema = 'auth'        // optional: a Postgres schema
//     id = uuid().primaryKey().defaultRandom()
//     @Rule({ format: 'email' }) email = varchar(120).notNull()
//   }
//   export const users = tableFromClass(Users)
//
// The fields ARE the builders, so their types reach `tableFromClass`'s return
// type — every column stays typed, unlike `@Column(builder) prop!: T`, where
// a decorator cannot hand its builder's type to the class. `tableName` is a
// static so its literal type survives too (a decorator argument would not).

type BuilderKeys<I> = { [K in keyof I]: I[K] extends ColumnBuilder ? K : never }[keyof I]
type BuilderFields<I> = { [K in BuilderKeys<I>]: I[K] extends ColumnBuilder ? I[K] : never }

interface TableClass {
  new (): object
  readonly tableName: string
  /** Indexes / unique constraints, over the table's column refs. */
  readonly indexes?: (refs: never) => Record<string, IndexDecl>
  /** Postgres schema the table lives in — `pgSchema(schema).table(...)`. */
  readonly schema?: string
}

const FIELD_RULES = Symbol.for('@forinda/kickjs-db/class-field-rules')

/** Rules that apply to a string column. */
export type StringRule = Pick<ColumnRule, 'format' | 'minLength' | 'maxLength' | 'pattern'>
/** Rules that apply to a numeric column. */
export type NumberRule = Pick<ColumnRule, 'minimum' | 'maximum'>

/** The rules a column of this builder may take — string rules on a number column fail to compile. */
export type RuleFor<B> =
  | SchemaLike
  | (B extends ColumnBuilder<infer T>
      ? [T] extends [string]
        ? StringRule
        : [T] extends [number]
          ? NumberRule
          : never
      : never)

/**
 * Validation a column's SQL type can't express, for `rulesOf(Class)`. The
 * rule has to fit the field: `@Rule({ minLength: 2 })` on an integer column
 * is a type error.
 */
export function Rule(
  rule: StringRule,
): <K extends string>(prototype: { [P in K]: ColumnBuilder<string> }, key: K) => void
export function Rule(
  rule: NumberRule,
): <K extends string>(prototype: { [P in K]: ColumnBuilder<number> }, key: K) => void
export function Rule(rule: SchemaLike): (prototype: object, key: string) => void
export function Rule(rule: ColumnRule | SchemaLike) {
  return (prototype: object, key: string): void => {
    const ctor = prototype.constructor as unknown as Record<symbol, Record<string, unknown>>
    if (!Object.hasOwn(ctor, FIELD_RULES)) ctor[FIELD_RULES] = { ...ctor[FIELD_RULES] }
    ctor[FIELD_RULES]![key] = rule
  }
}

const CLASS_TABLE = Symbol.for('@forinda/kickjs-db/class-field-table')

/** The table a builder-field class declares — built once. */
export function tableFromClass<C extends TableClass>(
  cls: C,
): TableDecl<
  C['tableName'],
  BuilderFields<InstanceType<C>>,
  C extends { schema: infer S extends string } ? (S extends 'public' ? undefined : S) : undefined
> & {
  [K in keyof BuilderFields<InstanceType<C>>]: ColumnRef
} {
  const meta = cls as unknown as Record<symbol, unknown>
  if (!Object.hasOwn(meta, CLASS_TABLE)) {
    // One instance, to read the initializers. The builders are the column
    // declarations themselves, so the table owns them from here on.
    const instance = new cls() as Record<string, unknown>
    const columns: Record<string, ColumnBuilder> = {}
    for (const [key, value] of Object.entries(instance)) {
      if (value instanceof ColumnBuilderClass) columns[key] = value as ColumnBuilder
    }
    if (Object.keys(columns).length === 0) throw new Error(`${cls.name} has no column fields`)
    meta[CLASS_TABLE] = build(cls.tableName, columns, cls.schema, cls.indexes)
  }
  return meta[CLASS_TABLE] as never
}

/** Column refs of a builder-field class, for its `static indexes`. */
export type ClassRefs<C extends new () => object> = {
  [K in keyof BuilderFields<InstanceType<C>>]: ColumnRef
}

// ── Variant C: base-class factory ───────────────────────────────────────
//
//   class User extends TableBase('users', {
//     id: uuid().primaryKey().defaultRandom(),
//     email: varchar(120).notNull(),
//   }, { rules: { email: { format: 'email' } } }) {
//     get domain() { return this.email.split('@')[1] }
//   }
//   User.table        // the TableDecl — for the client, migrations, insertSchema
//   User.from(row)    // a User carrying the row, with its methods
//
// The columns are an object literal, so every type is inferred exactly as
// with `table()`; the class adds a nominal row type that can hold methods.

type ColumnsRecord = Record<string, ColumnBuilder>
type RowOf<C extends ColumnsRecord> = {
  [K in keyof C]: C[K] extends ColumnBuilder<infer T>
    ? C[K] extends NotNullBrand
      ? T
      : T | null
    : never
}

export function TableBase<
  const N extends string,
  C extends ColumnsRecord,
  const S extends string | undefined = undefined,
>(
  name: N,
  columns: C,
  options: {
    schema?: S
    rules?: { [K in keyof C]?: RuleFor<C[K]> }
    indexes?: (refs: { [K in keyof C]: ColumnRef }) => Record<string, IndexDecl>
  } = {},
) {
  const decl = build(name, columns, options.schema, options.indexes as never) as TableDecl<
    N,
    C,
    S extends 'public' ? undefined : S
  > & { [K in keyof C]: ColumnRef }

  abstract class Base {
    static readonly table = decl
    static readonly rules = (options.rules ?? {}) as Record<string, ColumnRule | SchemaLike>
    /** A subclass instance carrying `row` — for methods over a row. */
    static from<T extends Base>(this: new () => T, row: RowOf<C>): T {
      return Object.assign(new this(), row)
    }
  }
  // One construct signature, returning the row — the class's own (Base) is
  // hidden, or `extends` sees two and rejects them.
  return Base as unknown as (abstract new () => RowOf<C>) & {
    readonly table: typeof decl
    readonly rules: Record<string, ColumnRule | SchemaLike>
    from<T>(this: new () => T, row: RowOf<C>): T
  }
}

// ── Variant D: fluent builder ───────────────────────────────────────────
//
//   export const users = defineTable('users')
//     .column('id', uuid().primaryKey().defaultRandom())
//     .column('email', varchar(120).notNull(), { format: 'email' })
//     .index((t) => ({ byEmail: unique('users_email').on(t.email) }))
//     .build()
//
// Each `.column` widens the builder's column type, so the result is typed as
// `table()` would be; a repeated name is a type error, and a rule must fit
// the column's type.

class TableDefinition<N extends string, C extends ColumnsRecord, S extends string | undefined> {
  constructor(
    private readonly name: N,
    private readonly schema: S,
    private readonly columns: C,
    private readonly columnRules: Record<string, ColumnRule | SchemaLike>,
    private readonly constraints?: (refs: never) => Record<string, IndexDecl>,
  ) {}

  column<const K extends string, B extends ColumnBuilder>(
    key: K extends keyof C ? never : K,
    builder: B,
    rule?: RuleFor<B>,
  ): TableDefinition<N, C & { [P in K]: B }, S> {
    return new TableDefinition(
      this.name,
      this.schema,
      { ...this.columns, [key]: builder } as C & { [P in K]: B },
      rule ? { ...this.columnRules, [key]: rule as ColumnRule | SchemaLike } : this.columnRules,
      this.constraints,
    )
  }

  index(
    constraints: (refs: { [K in keyof C]: ColumnRef }) => Record<string, IndexDecl>,
  ): TableDefinition<N, C, S> {
    return new TableDefinition(
      this.name,
      this.schema,
      this.columns,
      this.columnRules,
      constraints as never,
    )
  }

  build(): TableDecl<N, C, S extends 'public' ? undefined : S> & { [K in keyof C]: ColumnRef } {
    return build(this.name, this.columns, this.schema, this.constraints) as never
  }

  /** The `.column(..., rule)` rules, for `insertSchema`'s `columns` option. */
  rules(): { [K in keyof C]?: ColumnRule | SchemaLike } {
    return { ...this.columnRules } as never
  }
}

export function defineTable<const N extends string, const S extends string | undefined = undefined>(
  name: N,
  options: { schema?: S } = {},
): TableDefinition<N, {}, S> {
  return new TableDefinition(name, options.schema as S, {}, {})
}
