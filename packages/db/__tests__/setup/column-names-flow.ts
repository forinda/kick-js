/** The same `.colName()` round trip on any dialect: write, join, select *, upsert, db.query. */
import { expect } from 'vitest'
import type { KickDbClient } from '@forinda/kickjs-db'

export async function columnNamesFlow(db: KickDbClient<any>): Promise<void> {
  const ada = await db.upsert('users', {
    values: { email: 'ada@x.io', fullName: 'Ada' },
    target: ['email'],
  })
  expect(ada).toMatchObject({ email: 'ada@x.io', fullName: 'Ada' })
  expect(ada.updatedAt).toBeInstanceOf(Date)
  await db.insertInto('posts').values({ authorId: ada.id, email: 'p@x.io', title: 'One' }).execute()

  expect(
    await db
      .selectFrom('posts')
      .innerJoin('users', 'users.id', 'posts.authorId')
      .select(['users.email', 'posts.email as postEmail', 'posts.authorId'])
      .where('users.email', '=', 'ada@x.io')
      .execute(),
  ).toEqual([{ email: 'ada@x.io', postEmail: 'p@x.io', authorId: ada.id }])
  const all = await db.selectFrom('users').selectAll().executeTakeFirstOrThrow()
  expect(Object.keys(all).toSorted()).toEqual(['email', 'fullName', 'id', 'updatedAt'])

  await db.updateTable('users').set({ fullName: 'Ada L' }).where('email', '=', 'ada@x.io').execute()
  const found = await db.query.users.findMany({
    columns: { email: true, fullName: true },
    with: { posts: { columns: { title: true, authorId: true } } },
  })
  expect(found).toEqual([
    { email: 'ada@x.io', fullName: 'Ada L', posts: [{ title: 'One', authorId: ada.id }] },
  ])
  const post = await db.query.posts.findFirst({ with: { author: true } })
  expect(post!.author).toMatchObject({ email: 'ada@x.io', fullName: 'Ada L' })
}
