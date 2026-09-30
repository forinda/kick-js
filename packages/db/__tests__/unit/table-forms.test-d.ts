// Type-level guarantees of the table forms (run with --typecheck). Each
// `@ts-expect-error` is a mistake a form must reject — an unused one fails
// the run, so a form that stops catching it is caught here.
import { describe, expectTypeOf, it } from 'vitest'

import {
  Rule,
  TableBase,
  defineTable,
  fk,
  integer,
  link,
  relations,
  selfRef,
  serial,
  table,
  tableFromClass,
  text,
  unique,
  uuid,
  varchar,
  type ClassRefs,
  type SchemaToTypes,
} from '../../src/index'
import { pgEnum } from '../../src/dsl/columns/pg'
import type { InferInsert, InferSelect } from '../../src/schema'

type Row = { id: string; email: string; age: number; bio: string | null }

const O = table('users', {
  id: uuid().primaryKey().defaultRandom(),
  email: varchar(120).notNull(),
  age: integer().notNull().default(0),
  bio: text(),
})
class UsersB {
  static readonly tableName = 'users'
  id = uuid().primaryKey().defaultRandom()
  email = varchar(120).notNull()
  age = integer().notNull().default(0)
  bio = text()
}
const B = tableFromClass(UsersB)
class UserC extends TableBase('users', {
  id: uuid().primaryKey().defaultRandom(),
  email: varchar(120).notNull(),
  age: integer().notNull().default(0),
  bio: text(),
}) {}
const D = defineTable('users')
  .column('id', uuid().primaryKey().defaultRandom())
  .column('email', varchar(120).notNull())
  .column('age', integer().notNull().default(0))
  .column('bio', text())
  .build()

describe('row types match the object form', () => {
  it('select', () => {
    expectTypeOf<InferSelect<typeof B>>().toEqualTypeOf<Row>()
    expectTypeOf<InferSelect<typeof UserC.table>>().toEqualTypeOf<Row>()
    expectTypeOf<UserC>().toEqualTypeOf<Row>()
    expectTypeOf<InferSelect<typeof D>>().toEqualTypeOf<Row>()
    expectTypeOf<InferSelect<typeof O>>().toEqualTypeOf<Row>()
  })
  it('insert: defaulted and nullable columns optional', () => {
    for (const t of [O, B, UserC.table, D] as const) {
      expectTypeOf<{ email: string }>().toExtend<InferInsert<typeof t>>()
    }
  })
  it('enum columns keep their union', () => {
    const status = pgEnum('s', 'draft', 'published')
    const E = defineTable('p').column('s', status().notNull()).build()
    expectTypeOf<InferSelect<typeof E>['s']>().toEqualTypeOf<'draft' | 'published'>()
  })
})

describe('the table name reaches the typed client', () => {
  it('literal names', () => {
    expectTypeOf<keyof SchemaToTypes<{ B: typeof B }>>().toEqualTypeOf<'users'>()
    expectTypeOf<keyof SchemaToTypes<{ UserC: typeof UserC }>>().toEqualTypeOf<'users'>()
    expectTypeOf<keyof SchemaToTypes<{ D: typeof D }>>().toEqualTypeOf<'users'>()
  })
  it('schema-qualified names', () => {
    class Inv {
      static readonly tableName = 'invoices'
      static readonly schema = 'billing'
      id = uuid()
    }
    class InvC extends TableBase('invoices', { id: uuid() }, { schema: 'billing' }) {}
    const invD = defineTable('invoices', { schema: 'billing' }).column('id', uuid()).build()
    type Q = 'billing.invoices'
    expectTypeOf<
      keyof SchemaToTypes<{ i: ReturnType<typeof tableFromClass<typeof Inv>> }>
    >().toEqualTypeOf<Q>()
    expectTypeOf<keyof SchemaToTypes<{ i: typeof InvC }>>().toEqualTypeOf<Q>()
    expectTypeOf<keyof SchemaToTypes<{ i: typeof invD }>>().toEqualTypeOf<Q>()
  })
  it('a plain { table } object is not a table (runtime discovery ignores it too)', () => {
    expectTypeOf<keyof SchemaToTypes<{ w: { table: typeof D } }>>().toBeNever()
  })
  it('through relations()', () => {
    expectTypeOf(relations(B, () => ({})).__sourceTable).toEqualTypeOf<'users'>()
    expectTypeOf(relations(UserC.table, () => ({})).__sourceTable).toEqualTypeOf<'users'>()
    expectTypeOf(relations(D, () => ({})).__sourceTable).toEqualTypeOf<'users'>()
  })
})

describe('rules name real columns and fit their type', () => {
  it('builder fields: @Rule', () => {
    class X {
      static readonly tableName = 'x'
      @Rule({ format: 'email' }) email = varchar().notNull()
      @Rule({ minimum: 0 }) age = integer()
      // @ts-expect-error — string rule on an integer column
      @Rule({ minLength: 2 }) count = integer()
      // @ts-expect-error — number rule on a string column
      @Rule({ maximum: 3 }) name = text()
    }
    void X
  })
  it('base class: rules option', () => {
    class Ok extends TableBase(
      'ok',
      { email: varchar(), age: integer() },
      {
        rules: { email: { format: 'email' }, age: { minimum: 0 } },
      },
    ) {}
    class Typo extends TableBase(
      't',
      { email: varchar() },
      // @ts-expect-error — no such column
      { rules: { emial: { format: 'email' } } },
    ) {}
    // @ts-expect-error — string rule on an integer column
    class Kind extends TableBase('k', { age: integer() }, { rules: { age: { minLength: 1 } } }) {}
    void [Ok, Typo, Kind]
  })
  it('fluent: .column(key, builder, rule)', () => {
    defineTable('ok').column('email', varchar(), { format: 'email' })
    // @ts-expect-error — number rule on a string column
    defineTable('bad').column('email', varchar(), { minimum: 1 })
  })
})

describe('declaration mistakes', () => {
  it('fluent: a repeated column', () => {
    // @ts-expect-error — email declared twice
    defineTable('dup').column('email', varchar()).column('email', text())
  })
  it('indexes reference real columns', () => {
    class IdxB {
      static readonly tableName = 'b'
      // @ts-expect-error — no column `nope`
      static readonly indexes = (t: ClassRefs<typeof IdxB>) => ({ x: unique('b_x').on(t.nope) })
      slug = varchar()
    }
    class IdxC extends TableBase(
      'c',
      { slug: varchar() },
      // @ts-expect-error — no column `nope`
      { indexes: (t) => ({ x: unique('c_x').on(t.nope) }) },
    ) {}
    defineTable('d')
      .column('slug', varchar())
      // @ts-expect-error — no column `nope`
      .index((t) => ({ x: unique('d_x').on(t.nope) }))
    void [IdxB, IdxC]
  })
})

describe('typed foreign keys', () => {
  it('fk() and link() reject a type mismatch in every form, table() included', () => {
    fk(uuid(), () => O.id)
    // @ts-expect-error — integer → uuid
    fk(integer(), () => O.id)
    // @ts-expect-error — integer → uuid
    fk(integer(), () => B.id)
    // @ts-expect-error — integer → uuid
    fk(integer(), () => UserC.table.id)
    // @ts-expect-error — integer → uuid
    fk(integer(), () => D.id)
    const posts = table('posts', { id: serial().primaryKey() })
    link(O.age, () => posts.id)
    // @ts-expect-error — string column → integer key
    link(O.email, () => posts.id)
  })
})

// prettier-ignore
describe('self-references need no annotation', () => {
  it('table(): selfRef (a plain thunk is still TS7022)', () => {
    const ok = table('c', { id: uuid().primaryKey(), parentId: uuid().references(selfRef('id')) })
    // @ts-expect-error — 'bad' implicitly has type 'any'
    const bad = table('c', { id: uuid().primaryKey(), parentId: uuid().references(() => bad.id) })
    void [ok, bad]
  })
  it('builder fields: a plain thunk', () => {
    class C { static readonly tableName = 'c'; id = uuid().primaryKey(); parentId = uuid().references(() => c.id) }
    const c = tableFromClass(C)
    expectTypeOf<InferSelect<typeof c>['parentId']>().toEqualTypeOf<string | null>()
  })
  it('base class: selfRef', () => {
    class C extends TableBase('c', { id: uuid().primaryKey(), parentId: uuid().references(selfRef('id')) }) {}
    expectTypeOf<C['parentId']>().toEqualTypeOf<string | null>()
  })
  it('fluent: a column callback, key and type checked', () => {
    const c = defineTable('c').column('id', uuid().primaryKey()).column('parentId', (t) => fk(uuid(), () => t.id)).build()
    expectTypeOf<InferSelect<typeof c>['parentId']>().toEqualTypeOf<string | null>()
    // @ts-expect-error — no column `nope` yet
    defineTable('c').column('id', uuid()).column('parentId', (t) => fk(uuid(), () => t.nope))
    // @ts-expect-error — integer → uuid
    defineTable('c').column('id', uuid()).column('parentId', (t) => fk(integer(), () => t.id))
  })
})

// prettier-ignore
describe('cycles need no annotation', () => {
  it('builder fields: plain thunks both ways', () => {
    class A { static readonly tableName = 'a'; id = serial().primaryKey(); p = integer().references(() => p.id) }
    const a = tableFromClass(A)
    class P { static readonly tableName = 'p'; id = serial().primaryKey(); a = integer().references(() => a.id) }
    const p = tableFromClass(P)
    expectTypeOf<InferSelect<typeof p>['a']>().toEqualTypeOf<number | null>()
  })
  it('other forms: link() after both exist', () => {
    const a = defineTable('a').column('id', serial().primaryKey()).column('p', integer()).build()
    const p = defineTable('p').column('id', serial().primaryKey()).column('a', fk(integer(), () => a.id)).build()
    link(a.p, () => p.id)
  })
})
