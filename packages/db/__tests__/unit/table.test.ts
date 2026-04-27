import { describe, it, expect } from 'vitest'
import { table, serial, integer, varchar, index, unique } from '@forinda/kickjs-db'

describe('table() factory', () => {
  const users = table(
    'users',
    {
      id: serial().primaryKey(),
      email: varchar(255).notNull(),
    },
    (t) => ({
      emailIdx: index('users_email_idx').on(t.email),
    }),
  )

  it('exposes the table name', () => {
    expect(users.__name).toBe('users')
  })

  it('exposes columns by property name', () => {
    expect(Object.keys(users.__columns)).toEqual(['id', 'email'])
  })

  it('records single-column indexes from the third arg', () => {
    expect(users.__indexes).toEqual([
      { name: 'users_email_idx', columns: ['email'], unique: false },
    ])
  })

  it('table reference proxy carries column names back to the constraint helper', () => {
    expect(users.email.__name).toBe('email')
  })
})

describe('FK references', () => {
  const users = table('users', {
    id: serial().primaryKey(),
  })
  const posts = table('posts', {
    id: serial().primaryKey(),
    authorId: integer()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
  })

  it('records FK on the column state', () => {
    expect(posts.authorId.__state().references).toEqual({
      table: 'users',
      column: 'id',
      onDelete: 'cascade',
      onUpdate: 'no_action',
    })
  })
})

describe('unique constraint helper', () => {
  const t = table(
    'posts',
    {
      title: varchar(200).notNull(),
      authorId: integer().notNull(),
    },
    (t) => ({
      uniqSlug: unique('posts_slug_unique').on(t.title, t.authorId),
    }),
  )

  it('records multi-column unique', () => {
    expect(t.__indexes).toEqual([
      { name: 'posts_slug_unique', columns: ['title', 'authorId'], unique: true },
    ])
  })
})
