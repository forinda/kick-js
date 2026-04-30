import { describe, it, expect } from 'vitest'
import {
  table,
  relations,
  serial,
  integer,
  varchar,
  index,
  unique,
  extractSnapshot,
} from '@forinda/kickjs-db'

describe('extractSnapshot()', () => {
  const users = table(
    'users',
    {
      id: serial().primaryKey(),
      email: varchar(255).notNull().unique(),
    },
    (t) => ({
      emailIdx: index('users_email_idx').on(t.email),
    }),
  )

  const posts = table(
    'posts',
    {
      id: serial().primaryKey(),
      authorId: integer()
        .notNull()
        .references(() => users.id, { onDelete: 'cascade' }),
      title: varchar(200).notNull(),
    },
    (t) => ({
      uniqTitle: unique('posts_title_author_unique').on(t.title, t.authorId),
    }),
  )

  const usersRelations = relations(users, ({ many }) => ({ posts: many(posts) }))

  const schema = { users, posts, usersRelations }
  const snap = extractSnapshot(schema, 'postgres')

  it('emits version + dialect', () => {
    expect(snap.version).toBe(1)
    expect(snap.dialect).toBe('postgres')
  })

  it('skips relations decls (not DDL)', () => {
    expect(Object.keys(snap.tables).toSorted()).toEqual(['posts', 'users'])
  })

  it('captures users.email as nullable=false varchar(255)', () => {
    expect(snap.tables.users.columns.email).toEqual({
      name: 'email',
      type: 'varchar(255)',
      nullable: false,
      default: null,
      primaryKey: false,
    })
  })

  it('captures the unique on email', () => {
    expect(snap.tables.users.indexes).toContainEqual({
      name: 'users_email_unique',
      columns: ['email'],
      unique: true,
    })
  })

  it('captures the named index from the constraint callback', () => {
    expect(snap.tables.users.indexes).toContainEqual({
      name: 'users_email_idx',
      columns: ['email'],
      unique: false,
    })
  })

  it('captures the FK on posts.authorId', () => {
    expect(snap.tables.posts.foreignKeys).toEqual([
      {
        name: 'posts_authorId_fk',
        columns: ['authorId'],
        refTable: 'users',
        refColumns: ['id'],
        onDelete: 'cascade',
        onUpdate: 'no_action',
      },
    ])
  })

  it('captures the multi-column unique', () => {
    expect(snap.tables.posts.indexes).toContainEqual({
      name: 'posts_title_author_unique',
      columns: ['title', 'authorId'],
      unique: true,
    })
  })
})
