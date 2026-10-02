import { expectTypeOf, test } from 'vitest'
import type { Generated, GeneratedAlways } from 'kysely'
import { integer, numeric, serial, table, type SchemaToTypes } from '@forinda/kickjs-db'
import type { InferInsert } from '@forinda/kickjs-db/schema'

const orders = table('orders', {
  id: integer().generatedAlwaysAsIdentity().primaryKey(),
  ref: integer().generatedByDefaultAsIdentity(),
  serialNo: serial(),
  quantity: integer().notNull(),
  price: numeric(12, 2).notNull(),
  total: numeric(12, 2).generatedAlwaysAs('price * quantity'),
})

test('generated columns are GeneratedAlways; by-default identity is Generated', () => {
  type Row = SchemaToTypes<{ orders: typeof orders }>['orders']
  expectTypeOf<Row['id']>().toEqualTypeOf<GeneratedAlways<number>>()
  expectTypeOf<Row['total']>().toEqualTypeOf<GeneratedAlways<string | null>>()
  expectTypeOf<Row['ref']>().toEqualTypeOf<Generated<number>>()
  expectTypeOf<Row['quantity']>().toEqualTypeOf<number>()
})

test('insert rows leave out generated columns', () => {
  type Insert = InferInsert<typeof orders>
  expectTypeOf<Insert>().not.toHaveProperty('total')
  expectTypeOf<Insert>().not.toHaveProperty('id')
  expectTypeOf<Insert>().toHaveProperty('quantity')
})
