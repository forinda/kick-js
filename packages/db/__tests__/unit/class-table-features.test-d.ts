// PROOF OF CONCEPT — type-level side of the feature comparison (run with --typecheck).
import { describe, expectTypeOf, it } from 'vitest'

import { integer, relations, serial, table, text, uuid } from '../../src/index'
import { pgEnum } from '../../src/dsl/columns/pg'
import {
  Column,
  Table,
  TableBase,
  defineTable,
  fk,
  selfRef,
  tableFromClass,
  tableOf,
} from '../../src/class-table'
import type { InferSelect } from '../../src/schema'

const status = pgEnum('post_status', 'draft', 'published')

describe('enum columns keep their literal union', () => {
  it('O, B, C, D', () => {
    const O = table('p', { s: status().notNull() })
    class PB {
      static readonly tableName = 'p'
      s = status().notNull()
    }
    class PC extends TableBase('p', { s: status().notNull() }) {}
    const D = defineTable('p').column('s', status().notNull()).build()
    type U = 'draft' | 'published'
    expectTypeOf<InferSelect<typeof O>['s']>().toEqualTypeOf<U>()
    expectTypeOf<
      InferSelect<ReturnType<typeof tableFromClass<typeof PB>>>['s']
    >().toEqualTypeOf<U>()
    expectTypeOf<PC['s']>().toEqualTypeOf<U>()
    expectTypeOf<InferSelect<typeof D>['s']>().toEqualTypeOf<U>()
  })
  it('A: the property must be declared as the union (checked), the table type still loses it', () => {
    @Table('p')
    class PA {
      @Column(status().notNull()) s!: 'draft' | 'published'
      // @ts-expect-error — wider than the enum's values
      @Column(status().notNull()) t!: number
    }
    expectTypeOf<InferSelect<ReturnType<typeof tableOf<typeof PA>>>['s']>().toEqualTypeOf<unknown>()
  })
})

describe('typed foreign keys with fk()', () => {
  const users = defineTable('users').column('id', uuid().primaryKey()).build()
  class Team extends TableBase('teams', { id: serial().primaryKey() }) {}
  class TagsB {
    static readonly tableName = 'tags'
    id = integer().primaryKey()
  }
  const tags = tableFromClass(TagsB)

  it('matching types compile (B, C, D refs)', () => {
    fk(uuid(), () => users.id)
    fk(integer(), () => Team.table.id)
    fk(integer(), () => tags.id)
  })

  it('mismatched types are rejected (B, C, D refs)', () => {
    // @ts-expect-error — uuid column → integer (serial) key
    fk(uuid(), () => Team.table.id)
    // @ts-expect-error — integer column → uuid key
    fk(integer(), () => users.id)
    // @ts-expect-error — text column → integer key
    fk(text(), () => tags.id)
  })

  it('O: table() refs carry value types too, so fk() checks them', () => {
    const plain = table('plain', { id: serial().primaryKey() })
    fk(integer(), () => plain.id)
    // @ts-expect-error — uuid column → integer (serial) key
    fk(uuid(), () => plain.id)
  })
})

describe('relations() keeps the source name as a literal', () => {
  it('B, C, D literal; A string', () => {
    class UC extends TableBase('users', { id: serial() }) {}
    const D = defineTable('posts').column('id', serial()).build()
    class TB {
      static readonly tableName = 'tags'
      id = serial()
    }
    @Table('things')
    class TA {
      @Column(serial()) id!: number
    }
    expectTypeOf(relations(UC.table, () => ({})).__sourceTable).toEqualTypeOf<'users'>()
    expectTypeOf(relations(D, () => ({})).__sourceTable).toEqualTypeOf<'posts'>()
    expectTypeOf(relations(tableFromClass(TB), () => ({})).__sourceTable).toEqualTypeOf<'tags'>()
    expectTypeOf(relations(tableOf(TA), () => ({})).__sourceTable).toEqualTypeOf<string>()
  })
})

// Self-references with NO `(): ColumnRef =>` annotation. A form that needs
// one fails here with TS7022 / TS2506 — recorded with @ts-expect-error.
// prettier-ignore
describe('self-reference without an annotation', () => {
  it('O: table() needs the annotation (TS7022, the Drizzle pain)', () => {
    // @ts-expect-error — 'catO' implicitly has type 'any'
    const catO = table('c', { id: uuid().primaryKey(), parentId: uuid().references(() => catO.id) })
    void catO
  })

  it('B: compiles with a plain thunk', () => {
    class CatB {
      static readonly tableName = 'c'
      id = uuid().primaryKey()
      parentId = uuid().references(() => catB.id)
    }
    const catB = tableFromClass(CatB)
    expectTypeOf<InferSelect<typeof catB>['parentId']>().toEqualTypeOf<string | null>()
  })

  it('C: a plain thunk fails (TS2506), selfRef compiles', () => {
    // @ts-expect-error — 'CatC' is referenced in its own base expression
    class CatC extends TableBase('c', { id: uuid().primaryKey(), parentId: uuid().references(() => CatC.table.id) }) {}
    class CatC2 extends TableBase('c', { id: uuid().primaryKey(), parentId: uuid().references(selfRef('id')) }) {}
    expectTypeOf<CatC2['parentId']>().toEqualTypeOf<string | null>()
    void CatC
  })

  it('D: a plain thunk fails (TS7022), the column callback compiles and is checked', () => {
    // @ts-expect-error — 'catD' implicitly has type 'any'
    const catD = defineTable('c').column('id', uuid().primaryKey()).column('parentId', uuid().references(() => catD.id)).build()
    const catD2 = defineTable('c').column('id', uuid().primaryKey()).column('parentId', (t) => fk(uuid(), () => t.id)).build()
    expectTypeOf<InferSelect<typeof catD2>['parentId']>().toEqualTypeOf<string | null>()
    // @ts-expect-error — no column `nope` declared yet
    defineTable('c').column('id', uuid()).column('parentId', (t) => fk(uuid(), () => t.nope))
    // @ts-expect-error — integer column → uuid key
    defineTable('c').column('id', uuid()).column('parentId', (t) => fk(integer(), () => t.id))
    void catD
  })
})

// Circular foreign keys (a ↔ p) with NO annotations.
// prettier-ignore
describe('circular foreign keys without an annotation', () => {
  it('O fails (TS7022)', () => {
    // @ts-expect-error — implicit any
    const aO = table('a', { id: serial().primaryKey(), p: serial().references(() => pO.id) })
    // @ts-expect-error — implicit any
    const pO = table('p', { id: serial().primaryKey(), a: serial().references(() => aO.id) })
  })

  it('B compiles, with typed columns on both sides', () => {
    class AB { static readonly tableName = 'a'; id = serial().primaryKey(); p = serial().references(() => pB.id) }
    const aB = tableFromClass(AB)
    class PB { static readonly tableName = 'p'; id = serial().primaryKey(); a = serial().references(() => aB.id) }
    const pB = tableFromClass(PB)
    expectTypeOf<InferSelect<typeof aB>['p']>().toEqualTypeOf<number>()
    expectTypeOf<InferSelect<typeof pB>['a']>().toEqualTypeOf<number>()
  })

  it('C fails (TS2506)', () => {
    // @ts-expect-error — referenced in its own base expression
    class AC extends TableBase('a', { id: serial().primaryKey(), p: serial().references(() => PC.table.id) }) {}
    // @ts-expect-error — referenced in its own base expression
    class PC extends TableBase('p', { id: serial().primaryKey(), a: serial().references(() => AC.table.id) }) {}
  })

  it('D fails (TS7022)', () => {
    // @ts-expect-error — implicit any
    const aD = defineTable('a').column('id', serial().primaryKey()).column('p', serial().references(() => pD.id)).build()
    // @ts-expect-error — implicit any
    const pD = defineTable('p').column('id', serial().primaryKey()).column('a', serial().references(() => aD.id)).build()
  })
})
