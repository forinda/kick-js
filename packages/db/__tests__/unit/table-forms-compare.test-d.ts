// PROOF OF CONCEPT — type-level comparison over the same fixtures (run with --typecheck).
import { describe, expectTypeOf, it } from 'vitest'

import { integer } from '../../src/index'
import type { SchemaToTypes } from '../../src/index'
import { fk } from '../../src/class-table'
import type { InferSelect } from '../../src/schema'
import * as O from './fixtures/table-forms/o-object'
import * as A from './fixtures/table-forms/a-decorators'
import * as B from './fixtures/table-forms/b-fields'
import * as C from './fixtures/table-forms/c-base-class'
import * as D from './fixtures/table-forms/d-fluent'

type Post = {
  id: number
  authorId: string
  categoryId: string | null
  status: 'draft' | 'published'
  title: string
}
type Tables = 'users' | 'categories' | 'posts'

describe('typed client keys from the module (what createDbClient sees)', () => {
  it('O, B, C (classes), D', () => {
    expectTypeOf<keyof SchemaToTypes<typeof O>>().toEqualTypeOf<Tables>()
    expectTypeOf<keyof SchemaToTypes<typeof B>>().toEqualTypeOf<Tables>()
    expectTypeOf<keyof SchemaToTypes<typeof C>>().toEqualTypeOf<Tables>()
    expectTypeOf<keyof SchemaToTypes<typeof D>>().toEqualTypeOf<Tables>()
  })
  it('A: a meaningless `${string}.${string}` — name and schema are both plain string', () => {
    expectTypeOf<keyof SchemaToTypes<typeof A>>().toEqualTypeOf<`${string}.${string}`>()
  })
})

describe('row types', () => {
  it('O, B, C, D: exact', () => {
    expectTypeOf<InferSelect<typeof O.posts>>().toEqualTypeOf<Post>()
    expectTypeOf<InferSelect<typeof B.posts>>().toEqualTypeOf<Post>()
    expectTypeOf<InferSelect<typeof C.Post.table>>().toEqualTypeOf<Post>()
    expectTypeOf<C.Post>().toEqualTypeOf<Post>()
    expectTypeOf<InferSelect<typeof D.posts>>().toEqualTypeOf<Post>()
  })
  it('A: unknown', () => {
    expectTypeOf<InferSelect<typeof A.posts>['title']>().toEqualTypeOf<unknown>()
  })
})

describe('a mistyped foreign key is rejected', () => {
  it('O, B, C, D: integer → uuid key is a type error', () => {
    // @ts-expect-error — O
    fk(integer(), () => O.users.id)
    // @ts-expect-error — B
    fk(integer(), () => B.users.id)
    // @ts-expect-error — C
    fk(integer(), () => C.User.table.id)
    // @ts-expect-error — D
    fk(integer(), () => D.users.id)
  })
  it('A: accepted — its refs carry no value type', () => {
    fk(integer(), () => A.users.id)
  })
})

describe('relations keep the table name', () => {
  it('O, B, C, D', () => {
    expectTypeOf<typeof O.usersRelations.__sourceTable>().toEqualTypeOf<'users'>()
    expectTypeOf<typeof B.usersRelations.__sourceTable>().toEqualTypeOf<'users'>()
    expectTypeOf<typeof C.usersRelations.__sourceTable>().toEqualTypeOf<'users'>()
    expectTypeOf<typeof D.usersRelations.__sourceTable>().toEqualTypeOf<'users'>()
  })
})
