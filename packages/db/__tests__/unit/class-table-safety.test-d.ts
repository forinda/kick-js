// PROOF OF CONCEPT — the type-safety checklist, applied to every table form.
//
// Each criterion is a test per form. `@ts-expect-error` lines are mistakes the
// form must reject; a form that lets one through fails the typecheck run
// (an unused @ts-expect-error is an error). Where a form can't meet a
// criterion, the test asserts what it gives instead, so the gap is recorded.
//
//   O  object form          table('users', { ... })               (baseline)
//   A  decorators           @Table + @Column(builder) prop!: T
//   B  builder fields       class { static tableName; prop = builder } + tableFromClass
//   C  base-class factory   class X extends TableBase('users', { ... }) {}
//   D  fluent builder       defineTable('users').column(...).build()
import { describe, expectTypeOf, it } from 'vitest'

import { integer, table, text, unique, uuid, varchar } from '../../src/index'
import type { SchemaToTypes } from '../../src/index'
import {
  Column,
  Rule,
  Table,
  TableBase,
  defineTable,
  tableFromClass,
  tableOf,
  type ClassRefs,
} from '../../src/class-table'
import { insertSchema, type InferInsert, type InferSelect } from '../../src/schema'

type Expected = { id: string; email: string; age: number; bio: string | null }

const O = table('users', {
  id: uuid().primaryKey().defaultRandom(),
  email: varchar(120).notNull(),
  age: integer().notNull().default(0),
  bio: text(),
})

@Table('users')
class UserA {
  @Column(uuid().primaryKey().defaultRandom()) id!: string
  @Column(varchar(120).notNull()) email!: string
  @Column(integer().notNull().default(0)) age!: number
  @Column(text()) bio!: string | null
}
const A = tableOf(UserA)

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
const C = UserC.table

const D = defineTable('users')
  .column('id', uuid().primaryKey().defaultRandom())
  .column('email', varchar(120).notNull())
  .column('age', integer().notNull().default(0))
  .column('bio', text())
  .build()

describe('1. select row type is exact', () => {
  it('O, B, C, D', () => {
    expectTypeOf<InferSelect<typeof O>>().toEqualTypeOf<Expected>()
    expectTypeOf<InferSelect<typeof B>>().toEqualTypeOf<Expected>()
    expectTypeOf<InferSelect<typeof C>>().toEqualTypeOf<Expected>()
    expectTypeOf<InferSelect<typeof D>>().toEqualTypeOf<Expected>()
  })
  it('A: unknown — a decorator cannot give its builder type to the class', () => {
    expectTypeOf<InferSelect<typeof A>['email']>().toEqualTypeOf<unknown>()
  })
  it('C: the class itself is the row type', () => {
    expectTypeOf<UserC>().toEqualTypeOf<Expected>()
  })
})

describe('2. insert knows what the database fills', () => {
  it('O, B, C, D: id and age optional, email required', () => {
    for (const _ of [0]) {
      expectTypeOf<{ email: string }>().toExtend<InferInsert<typeof O>>()
      expectTypeOf<{ email: string }>().toExtend<InferInsert<typeof B>>()
      expectTypeOf<{ email: string }>().toExtend<InferInsert<typeof C>>()
      expectTypeOf<{ email: string }>().toExtend<InferInsert<typeof D>>()
      expectTypeOf<{ age: number }>().not.toExtend<InferInsert<typeof D>>()
    }
  })
})

describe('3. literal table name reaches the typed client', () => {
  it('O, B, C, D', () => {
    expectTypeOf<keyof SchemaToTypes<{ users: typeof O }>>().toEqualTypeOf<'users'>()
    expectTypeOf<keyof SchemaToTypes<{ users: typeof B }>>().toEqualTypeOf<'users'>()
    expectTypeOf<keyof SchemaToTypes<{ users: typeof C }>>().toEqualTypeOf<'users'>()
    expectTypeOf<keyof SchemaToTypes<{ users: typeof D }>>().toEqualTypeOf<'users'>()
  })
  it('A: string', () => {
    expectTypeOf<typeof A.__name>().toEqualTypeOf<string>()
  })
  it('C, D: a Postgres schema qualifies it', () => {
    class Inv extends TableBase('invoices', { id: uuid() }, { schema: 'billing' }) {}
    const inv = defineTable('invoices', { schema: 'billing' }).column('id', uuid()).build()
    expectTypeOf<keyof SchemaToTypes<{ i: typeof Inv.table }>>().toEqualTypeOf<'billing.invoices'>()
    expectTypeOf<keyof SchemaToTypes<{ i: typeof inv }>>().toEqualTypeOf<'billing.invoices'>()
  })
})

describe('4. rules must name a real column and fit its type', () => {
  it('B: @Rule is checked against the field', () => {
    class Bad {
      static readonly tableName = 'bad'
      @Rule({ format: 'email' }) email = varchar().notNull()
      @Rule({ minimum: 0 }) age = integer()
      // @ts-expect-error — a string rule on an integer column
      @Rule({ minLength: 2 }) count = integer()
      // @ts-expect-error — a number rule on a string column
      @Rule({ maximum: 3 }) name = text()
    }
    void Bad
  })
  it('C: rules keyed by column, typed per column', () => {
    class Ok extends TableBase(
      'ok',
      { email: varchar().notNull(), age: integer() },
      { rules: { email: { format: 'email' }, age: { minimum: 0 } } },
    ) {}
    class Typo extends TableBase(
      't',
      { email: varchar().notNull() },
      // @ts-expect-error — no such column
      { rules: { emial: { format: 'email' } } },
    ) {}
    class WrongKind extends TableBase(
      'w',
      { age: integer() },
      // @ts-expect-error — string rule on an integer column
      { rules: { age: { minLength: 1 } } },
    ) {}
    void [Ok, Typo, WrongKind]
  })
  it('D: .column(..., rule) typed per column', () => {
    defineTable('ok').column('email', varchar(), { format: 'email' })
    // @ts-expect-error — number rule on a string column
    defineTable('bad').column('email', varchar(), { minimum: 1 })
  })
  it('insertSchema columns: keyed by real columns for every typed form', () => {
    insertSchema(D, { columns: { email: { format: 'email' } } })
    // @ts-expect-error — no such column
    insertSchema(D, { columns: { emial: { format: 'email' } } })
  })
})

describe('5. mistakes in the declaration itself', () => {
  it('A: declared property type is checked against the builder', () => {
    @Table('m')
    class M {
      // @ts-expect-error — integer column, string property
      @Column(integer().notNull()) age!: string
    }
    void M
  })
  it('D: a repeated column name is rejected', () => {
    // @ts-expect-error — email declared twice
    defineTable('dup').column('email', varchar()).column('email', text())
  })
})

describe('6. indexes only reference real columns', () => {
  it('B, C, D', () => {
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
