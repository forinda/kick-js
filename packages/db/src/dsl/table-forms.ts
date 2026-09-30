/**
 * Other ways to declare a table. Each one hands the same builders to
 * `table()` / `pgSchema(schema).table()`, so what comes out is an ordinary
 * table: snapshots, migrations, the query client and `insertSchema` can't
 * tell which form declared it.
 *
 *   // builder fields — plain thunks even for self-references and cycles
 *   class Users {
 *     static readonly tableName = 'users'
 *     id = uuid().primaryKey().defaultRandom()
 *     @Rule({ format: 'email' }) email = varchar(120).notNull()
 *   }
 *   export const users = tableFromClass(Users)
 *
 *   // base class — the class is the row type and can carry methods
 *   export class User extends TableBase('users', { id: uuid().primaryKey(), email: varchar(120).notNull() }) {}
 *
 *   // fluent — typed self-references, duplicate columns rejected
 *   export const users = defineTable('users').column('id', uuid().primaryKey()).build()
 *
 * Validation rules declared with a form (`@Rule`, `rules`, `.column(k, b, rule)`)
 * travel with the table: `insertSchema(users)` applies them.
 */
import type { ColumnRule, SchemaLike } from '../schema'
import type {
  ColumnBuilder,
  ColumnRef,
  NotNullBrand,
  TypedColumnRef,
  TypedColumnRefs,
} from './columns/types'
import { ColumnBuilder as ColumnBuilderClass } from './columns/types'
import type { IndexDecl } from './constraints'
import { pgSchema } from './pg-schema'
import { table, type TableDecl } from './table'

type ColumnsRecord = Record<string, ColumnBuilder>
type Constraints = (refs: never) => Record<string, IndexDecl>
type Rules = Record<string, ColumnRule | SchemaLike>

/** The Postgres schema of a table: `undefined` for none or `public`. */
type SchemaOf<S> = S extends string ? (S extends 'public' ? undefined : `${S}`) : undefined

/**
 * Build through `table()` / `pgSchema(schema).table()` — the one place every
 * form turns into a table — and attach the form's validation rules, which
 * `insertSchema` / `selectSchema` / `updateSchema` read.
 */
function build(
  name: string,
  columns: ColumnsRecord,
  schema: string | undefined,
  constraints: Constraints | undefined,
  rules: Rules,
) {
  const decl = schema
    ? pgSchema(schema).table(name, columns, constraints as never)
    : table(name, columns, constraints as never)
  // Not enumerable: a table's own keys are its column refs.
  if (Object.keys(rules).length > 0) {
    Object.defineProperty(decl, '__rules', { value: { ...rules }, enumerable: false })
  }
  return decl
}

// ── Rules ───────────────────────────────────────────────────────────────

/** Rules for a string column. */
export type StringRule = Pick<ColumnRule, 'format' | 'minLength' | 'maxLength' | 'pattern'>
/** Rules for a numeric column. */
export type NumberRule = Pick<ColumnRule, 'minimum' | 'maximum'>

/** The rules a column of this builder may take — a string rule on a number column fails to compile. */
export type RuleFor<B> =
  | SchemaLike
  | (B extends ColumnBuilder<infer T>
      ? [T] extends [string]
        ? StringRule
        : [T] extends [number]
          ? NumberRule
          : never
      : never)

// ── Builder fields ──────────────────────────────────────────────────────

type BuilderKeys<I> = { [K in keyof I]: I[K] extends ColumnBuilder ? K : never }[keyof I]
type BuilderFields<I> = { [K in BuilderKeys<I>]: I[K] extends ColumnBuilder ? I[K] : never }

/** A class whose fields are column builders — the input to {@link tableFromClass}. */
export interface TableClass {
  new (): object
  /** The table's name. */
  readonly tableName: string
  /** Postgres schema the table lives in — `pgSchema(schema).table(...)`. */
  readonly schema?: string
  /** Indexes / unique constraints, over {@link ClassRefs} of the class. */
  readonly indexes?: (refs: never) => Record<string, IndexDecl>
}

/** Column refs of a builder-field class, for its `static indexes`. */
export type ClassRefs<C extends new () => object> = TypedColumnRefs<BuilderFields<InstanceType<C>>>

const FIELD_RULES = Symbol.for('@forinda/kickjs-db/field-rules')
const CLASS_TABLE = Symbol.for('@forinda/kickjs-db/class-table')

/**
 * Validation a column's SQL type can't express, on a builder field. The rule
 * has to fit the column: `@Rule({ minLength: 2 })` on an integer column is a
 * type error.
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
    const ctor = prototype.constructor as unknown as Record<symbol, Rules>
    if (!Object.hasOwn(ctor, FIELD_RULES)) ctor[FIELD_RULES] = { ...ctor[FIELD_RULES] }
    ctor[FIELD_RULES]![key] = rule
  }
}

/**
 * The table a builder-field class declares — built once, then the same
 * object on every call. Fields that aren't column builders are ignored.
 */
export function tableFromClass<C extends TableClass>(
  cls: C,
): TableDecl<
  // Re-stated as a template literal: `static readonly x = 'users'` is a
  // *widening* literal, which becomes `string` the moment the table goes
  // through a generic function (relations(), the client) — losing the key.
  `${C['tableName']}`,
  BuilderFields<InstanceType<C>>,
  C extends { schema: infer S } ? SchemaOf<S> : undefined
> &
  TypedColumnRefs<BuilderFields<InstanceType<C>>> {
  const meta = cls as unknown as Record<symbol, unknown>
  if (!Object.hasOwn(meta, CLASS_TABLE)) {
    // One instance, to read the initializers. The builders are the column
    // declarations themselves, so the table owns them from here on.
    const instance = new cls() as Record<string, unknown>
    const columns: ColumnsRecord = {}
    for (const [key, value] of Object.entries(instance)) {
      if (value instanceof ColumnBuilderClass) columns[key] = value
    }
    if (Object.keys(columns).length === 0) throw new Error(`${cls.name} has no column fields`)
    const rules = (meta[FIELD_RULES] as Rules | undefined) ?? {}
    meta[CLASS_TABLE] = build(cls.tableName, columns, cls.schema, cls.indexes, rules)
  }
  return meta[CLASS_TABLE] as never
}

// ── Base class ──────────────────────────────────────────────────────────

type RowOf<C extends ColumnsRecord> = {
  [K in keyof C]: C[K] extends ColumnBuilder<infer T>
    ? C[K] extends NotNullBrand
      ? T
      : T | null
    : never
}

/**
 * A class for a table: `class User extends TableBase('users', { ... }) {}`.
 * The columns are an object literal, so types infer exactly as with
 * `table()`. The class is the row type and can hold methods; `User.table` is
 * the table, and exporting the class is enough for `kick db generate` and
 * `createDbClient({ schema })`.
 */
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
    indexes?: (refs: TypedColumnRefs<C>) => Record<string, IndexDecl>
  } = {},
) {
  const decl = build(
    name,
    columns,
    options.schema,
    options.indexes as Constraints | undefined,
    (options.rules ?? {}) as Rules,
  ) as TableDecl<N, C, SchemaOf<S>> & TypedColumnRefs<C>

  abstract class Base {
    static readonly table = decl
    /** A subclass instance holding `row` — for methods over a row. */
    static from<T extends Base>(this: new () => T, row: RowOf<C>): T {
      return Object.assign(new this(), row)
    }
  }
  // One construct signature, returning the row. The class's own would make
  // a second, and `extends` rejects two ("Base constructors must all have the
  // same return type").
  return Base as unknown as (abstract new () => RowOf<C>) & {
    readonly table: typeof decl
    from<T>(this: new () => T, row: RowOf<C>): T
  }
}

// ── Fluent ──────────────────────────────────────────────────────────────

/** A table being declared column by column — see {@link defineTable}. */
export class TableDefinition<
  N extends string,
  C extends ColumnsRecord,
  S extends string | undefined,
> {
  constructor(
    private readonly name: N,
    private readonly schema: S,
    private readonly columns: C,
    private readonly columnRules: Rules,
    private readonly constraints: Constraints | undefined,
    /** Shared by every step of one chain; `build()` fills it in. */
    private readonly built: { decl?: Record<string, ColumnRef> },
  ) {}

  /**
   * Add a column. A name already declared is a type error, and `rule` must
   * fit the column. `builder` may be a function of the columns declared so
   * far — a self-reference with no annotation, key and type checked:
   * `.column('parentId', (t) => fk(uuid(), () => t.id))`.
   */
  column<const K extends string, B extends ColumnBuilder>(
    key: K extends keyof C ? never : K,
    builder: B | ((refs: TypedColumnRefs<C>) => B),
    rule?: RuleFor<B>,
  ): TableDefinition<N, C & { [P in K]: B }, S> {
    const resolved =
      typeof builder === 'function' ? builder(this.lazyRefs() as TypedColumnRefs<C>) : builder
    return new TableDefinition(
      this.name,
      this.schema,
      { ...this.columns, [key]: resolved } as C & { [P in K]: B },
      rule ? { ...this.columnRules, [key]: rule as ColumnRule | SchemaLike } : this.columnRules,
      this.constraints,
      this.built,
    )
  }

  /** Indexes / unique constraints over the columns declared so far. Calls add up. */
  index(
    constraints: (refs: TypedColumnRefs<C>) => Record<string, IndexDecl>,
  ): TableDefinition<N, C, S> {
    const previous = this.constraints
    const next = constraints as Constraints
    const combined: Constraints = previous ? (refs) => ({ ...previous(refs), ...next(refs) }) : next
    return new TableDefinition(
      this.name,
      this.schema,
      this.columns,
      this.columnRules,
      combined,
      this.built,
    )
  }

  build(): TableDecl<N, C, SchemaOf<S>> & TypedColumnRefs<C> {
    const decl = build(this.name, this.columns, this.schema, this.constraints, this.columnRules)
    this.built.decl = decl as unknown as Record<string, ColumnRef>
    return decl as never
  }

  /**
   * Refs for `.column(key, (t) => ...)` callbacks. The table doesn't exist
   * yet, so each ref resolves when a foreign-key thunk runs — after `build()`.
   */
  private lazyRefs(): Record<string, ColumnRef> {
    const built = this.built
    const owner =
      this.schema && this.schema !== 'public' ? `${this.schema}.${this.name}` : this.name
    return new Proxy({} as Record<string, ColumnRef>, {
      get: (_, key: string) =>
        ({
          __tableName: owner,
          __name: key,
          get __builder() {
            return built.decl![key]!.__builder
          },
          __state: () => built.decl![key]!.__state(),
        }) as ColumnRef,
    })
  }
}

/**
 * Declare a table column by column:
 * `defineTable('users').column('id', uuid().primaryKey()).build()`.
 */
export function defineTable<const N extends string, const S extends string | undefined = undefined>(
  name: N,
  options: { schema?: S } = {},
): TableDefinition<N, {}, S> {
  return new TableDefinition(name, options.schema as S, {}, {}, undefined, {})
}

// ── Typed foreign keys ──────────────────────────────────────────────────

/**
 * A foreign key whose target must hold the same type:
 * `authorId: fk(uuid().notNull(), () => users.id)` — a uuid column pointing
 * at a serial key is a type error. Same as `.references()` at runtime.
 */
export function fk<T, B extends ColumnBuilder<T>>(
  builder: B & ColumnBuilder<T>,
  target: () => TypedColumnRef<NoInfer<T>>,
  options: Parameters<ColumnBuilder['references']>[1] = {},
): B {
  return builder.references(target, options) as B
}

/**
 * Add a foreign key to a column after both tables exist — how two tables
 * reference each other without an annotation:
 *
 *   const users = table('users', { id: uuid().primaryKey(), featuredPostId: integer() })
 *   const posts = table('posts', { id: serial().primaryKey(), authorId: fk(uuid(), () => users.id) })
 *   link(users.featuredPostId, () => posts.id)
 *
 * Declared inside the initializers, each table's type would wait on the
 * other's (TS7022). References are read at snapshot time, so adding one
 * afterwards is the same as declaring it.
 */
export function link<T>(
  column: TypedColumnRef<T>,
  target: () => TypedColumnRef<NoInfer<T>>,
  options: Parameters<ColumnBuilder['references']>[1] = {},
): void {
  column.__builder.references(target, options)
}
