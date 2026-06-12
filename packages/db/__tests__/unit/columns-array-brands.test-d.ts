// Type-level companion to columns-array-brands.test.ts. Lives in a
// `.test-d.ts` file because vitest only enforces expectTypeOf assertions
// under `--typecheck`, whose include list is `**/*.test-d.ts`.
//
// Run: vitest run --typecheck --typecheck.ignoreSourceErrors \
//        __tests__/unit/columns-array-brands.test-d.ts
import { describe, it, expectTypeOf } from 'vitest'
import type { Generated } from 'kysely'

import { integer, varchar, uuid, table } from '../../src/index'
import type { SchemaToTypes } from '../../src/index'

describe('array() brand preservation (type-level)', () => {
  it('notNull().array() keeps NOT NULL in the row type', () => {
    const tags = table('tags', {
      id: uuid().primaryKey().defaultRandom(),
      names: varchar(64).notNull().array(),
      maybe: integer().array(), // no brands — stays nullable
    })
    const schema = { tags }
    type DB = SchemaToTypes<typeof schema>

    expectTypeOf<DB['tags']>().toEqualTypeOf<{
      id: Generated<string>
      names: string[]
      maybe: number[] | null
    }>()
  })

  it('default().array() keeps the Generated wrapper', () => {
    const t = table('t', {
      id: uuid().primaryKey().defaultRandom(),
      counts: integer().notNull().default(0).array(),
    })
    const schema = { t }
    type DB = SchemaToTypes<typeof schema>

    expectTypeOf<DB['t']['counts']>().toEqualTypeOf<Generated<number[]>>()
  })
})
