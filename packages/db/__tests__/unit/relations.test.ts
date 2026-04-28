import { describe, it, expect } from 'vitest'
import { table, serial, integer, relations } from '@forinda/kickjs-db'

describe('relations()', () => {
  const users = table('users', { id: serial().primaryKey() })
  const posts = table('posts', {
    id: serial().primaryKey(),
    authorId: integer().notNull(),
  })

  const usersRelations = relations(users, ({ many }) => ({ posts: many(posts) }))
  const postsRelations = relations(posts, ({ one }) => ({
    author: one(users, { fields: [posts.authorId], references: [users.id] }),
  }))

  it('marks relation declarations with __isRelations', () => {
    expect(usersRelations.__isRelations).toBe(true)
    expect(postsRelations.__isRelations).toBe(true)
  })

  it('records source table name', () => {
    expect(usersRelations.__sourceTable).toBe('users')
  })

  it('exposes relation map', () => {
    expect(usersRelations.__relations.posts.kind).toBe('many')
    expect(postsRelations.__relations.author.kind).toBe('one')
  })
})
