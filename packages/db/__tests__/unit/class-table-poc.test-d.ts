// PROOF OF CONCEPT — type-level behaviour of the two class forms (run with --typecheck).
import { describe, expectTypeOf, it } from 'vitest'

import { integer, serial, text, varchar } from '../../src/index'
import type { SchemaToTypes } from '../../src/index'
import { Column, Table, tableFromClass, tableOf } from '../../src/class-table'
import type { InferInsert, InferSelect } from '../../src/schema'

describe('A: @Column checks the declared property type against the builder', () => {
  it('accepts matching types and rejects a mismatch', () => {
    @Table('ok')
    class Ok {
      @Column(serial()) id!: number
      @Column(varchar().notNull()) name!: string
      @Column(text()) bio!: string | null
      // @ts-expect-error — integer column, string property
      @Column(integer().notNull()) age!: string
      // @ts-expect-error — NOT NULL column declared nullable
      @Column(varchar().notNull()) nick!: string | null
    }
    void Ok
  })

  it('but loses the column types: a decorator cannot pass its builder type on', () => {
    @Table('users')
    class User {
      @Column(varchar().notNull()) email!: string
    }
    type Row = InferSelect<ReturnType<typeof tableOf<typeof User>>>
    expectTypeOf<Row['email']>().toEqualTypeOf<unknown>()
    // …and the table name is `string`, so the typed client can't key it.
    expectTypeOf<ReturnType<typeof tableOf<typeof User>>['__name']>().toEqualTypeOf<string>()
  })
})

describe('B: builder fields keep every type', () => {
  class Users {
    static readonly tableName = 'users'
    id = serial()
    email = varchar().notNull()
    bio = text()
  }
  const users = tableFromClass(Users)

  it('row types match the object form', () => {
    expectTypeOf<InferSelect<typeof users>>().toEqualTypeOf<{
      id: number
      email: string
      bio: string | null
    }>()
    expectTypeOf<{ email: 'a' }>().toExtend<InferInsert<typeof users>>()
  })

  it('the literal table name reaches the client types', () => {
    expectTypeOf<typeof users.__name>().toEqualTypeOf<'users'>()
    expectTypeOf<keyof SchemaToTypes<{ users: typeof users }>>().toEqualTypeOf<'users'>()
  })

  it('a static schema qualifies the name', () => {
    class Invoices {
      static readonly tableName = 'invoices'
      static readonly schema = 'billing'
      id = serial()
    }
    const invoices = tableFromClass(Invoices)
    expectTypeOf<
      keyof SchemaToTypes<{ invoices: typeof invoices }>
    >().toEqualTypeOf<'billing.invoices'>()
  })
})
