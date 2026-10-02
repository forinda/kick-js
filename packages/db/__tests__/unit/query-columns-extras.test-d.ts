/** D.19: the row type follows `columns` and `extras`, at every level. */
import { expectTypeOf, test } from 'vitest'
import { sql, type Generated } from 'kysely'
import type { FindManyOptions, FindManyRow } from '../../src/query/types'

interface DB {
  users: { id: Generated<string>; email: string; isActive: boolean }
  posts: { id: Generated<string>; authorId: string; title: string; publishedAt: Date | null }
  comments: { id: Generated<string>; postId: string; body: string }
  categories: { id: Generated<string>; parentId: string | null; name: string }
}

const opts = {
  columns: { isActive: false },
  extras: { shout: () => sql<string>`upper(email)` },
  with: { posts: { columns: { id: true, title: true } } },
} satisfies FindManyOptions<DB, 'users'>

test('columns narrow the row; extras add typed fields', () => {
  type Row = FindManyRow<DB, 'users', typeof opts>
  expectTypeOf<Row>().not.toHaveProperty('isActive')
  expectTypeOf<Row['email']>().toEqualTypeOf<string>()
  expectTypeOf<Row['shout']>().toEqualTypeOf<string>()
  expectTypeOf<keyof Row['posts'][number]>().toEqualTypeOf<'id' | 'title'>()
})

test('without columns or extras the row is unchanged', () => {
  type Row = FindManyRow<DB, 'users', {}>
  expectTypeOf<keyof Row>().toEqualTypeOf<'id' | 'email' | 'isActive'>()
})

test('a boolean flag makes a column optional, not absent', () => {
  const flag = Math.random() > 0.5
  const o = { columns: { email: flag, id: true } } satisfies FindManyOptions<DB, 'users'>
  type Row = FindManyRow<DB, 'users', typeof o>
  expectTypeOf<Row['email']>().toEqualTypeOf<string | undefined>()
  expectTypeOf<keyof Row>().toEqualTypeOf<'id' | 'email'>()
})

test('a scalar subquery extra is its column value, or null; the correlated ref type-checks', () => {
  const o = {
    extras: {
      postCount: (_u, eb) =>
        eb
          .selectFrom('posts')
          .select(eb.fn.countAll<number>().as('n'))
          .where('posts.authorId', '=', sql.ref<string>('users_0.id')),
    },
  } satisfies FindManyOptions<DB, 'users'>
  type Row = FindManyRow<DB, 'users', typeof o>
  expectTypeOf<Row['postCount']>().toEqualTypeOf<number | null>()
})
