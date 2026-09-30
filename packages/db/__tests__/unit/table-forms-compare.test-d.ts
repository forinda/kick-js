// PROOF OF CONCEPT — type-level comparison over the same fixtures (run with --typecheck).
import { describe, expectTypeOf, it } from 'vitest'

import { integer } from '../../src/index'
import type { SchemaToTypes } from '../../src/index'
import { fk } from '../../src/index'
import type { InferSelect } from '../../src/schema'
import * as O from './fixtures/table-forms/o-object'
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
})

describe('row types', () => {
  it('O, B, C, D: exact', () => {
    expectTypeOf<InferSelect<typeof O.posts>>().toEqualTypeOf<Post>()
    expectTypeOf<InferSelect<typeof B.posts>>().toEqualTypeOf<Post>()
    expectTypeOf<InferSelect<typeof C.Post.table>>().toEqualTypeOf<Post>()
    expectTypeOf<C.Post>().toEqualTypeOf<Post>()
    expectTypeOf<InferSelect<typeof D.posts>>().toEqualTypeOf<Post>()
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
})

describe('relations keep the table name', () => {
  it('O, B, C, D', () => {
    expectTypeOf<typeof O.usersRelations.__sourceTable>().toEqualTypeOf<'users'>()
    expectTypeOf<typeof B.usersRelations.__sourceTable>().toEqualTypeOf<'users'>()
    expectTypeOf<typeof C.usersRelations.__sourceTable>().toEqualTypeOf<'users'>()
    expectTypeOf<typeof D.usersRelations.__sourceTable>().toEqualTypeOf<'users'>()
  })
})
