// Type-level companion to table-schema.test.ts (run with --typecheck).
import { describe, expectTypeOf, it } from 'vitest'
import type { InferSchemaOutput } from '@forinda/kickjs-schema'

import { integer, jsonb, serial, table, text, uuid, varchar } from '../../src/index'
import {
  insertSchema,
  selectSchema,
  updateSchema,
  type InferInsert,
  type InferSelect,
} from '../../src/schema'

const users = table('users', {
  id: uuid().primaryKey().defaultRandom(),
  seq: serial(),
  email: varchar().notNull(),
  name: text(),
  age: integer().notNull().default(0),
  meta: jsonb<{ theme: string }>(),
})

describe('row types', () => {
  it('select: every column, nullable ones with null', () => {
    expectTypeOf<InferSelect<typeof users>>().toEqualTypeOf<{
      id: string
      seq: number
      email: string
      name: string | null
      age: number
      meta: { theme: string } | null
    }>()
  })

  it('insert: generated, defaulted and nullable columns are optional', () => {
    type Row = InferInsert<typeof users>
    expectTypeOf<Row['email']>().toEqualTypeOf<string>()
    expectTypeOf<{ email: 'a' }>().toExtend<Row>()
    expectTypeOf<{ id: string }>().not.toExtend<Row>()
  })
})

describe('schema output types flow to InferSchemaOutput (typegen / typed ctx.body)', () => {
  it('insert, with omit', () => {
    const schema = insertSchema(users, { omit: ['id', 'seq'] })
    type Out = InferSchemaOutput<typeof schema>
    expectTypeOf<Out>().toHaveProperty('email')
    expectTypeOf<keyof Out>().toEqualTypeOf<'email' | 'name' | 'age' | 'meta'>()
  })

  it('select and update', () => {
    expectTypeOf<InferSchemaOutput<ReturnType<typeof selectSchema<typeof users>>>>().toEqualTypeOf<
      InferSelect<typeof users>
    >()
    type Patch = InferSchemaOutput<ReturnType<typeof updateSchema<typeof users>>>
    expectTypeOf<{}>().toExtend<Patch>()
  })
})
