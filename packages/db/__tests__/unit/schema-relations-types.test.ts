/**
 * Type-level coverage for `SchemaToRelationsRegister<S>` — the
 * helper consumed by the kick/db typegen plugin to derive the
 * relations augmentation from the schema barrel itself.
 *
 * Asserts that the returned shape matches what a hand-rolled
 * `KickDbRelationsRegister['db']` declaration would carry, so
 * adopters who delete the hand-rolled file get the exact same
 * type surface from the typegen output.
 *
 * Spec: docs/db/spec-relational-query.md §3.2.
 */

import { describe, expectTypeOf, it } from 'vitest'
import { relations, table, serial, uuid, varchar, integer } from '../../src/index'
import type { SchemaToRelationsRegister } from '../../src/index'

const users = table('users', {
  id: uuid().primaryKey().defaultRandom(),
  email: varchar(255).notNull().unique(),
})

const posts = table('posts', {
  id: serial().primaryKey(),
  authorId: uuid()
    .notNull()
    .references(() => users.id),
  title: varchar(255).notNull(),
})

const comments = table('comments', {
  id: serial().primaryKey(),
  postId: integer()
    .notNull()
    .references(() => posts.id),
  body: varchar(1000).notNull(),
})

const usersRelations = relations(users, (h) => ({
  posts: h.many(posts),
}))

const postsRelations = relations(posts, (h) => ({
  author: h.one(users, { fields: [posts.authorId], references: [users.id] }),
  comments: h.many(comments),
}))

const commentsRelations = relations(comments, (h) => ({
  post: h.one(posts, { fields: [comments.postId], references: [posts.id] }),
}))

const schema = {
  users,
  posts,
  comments,
  usersRelations,
  postsRelations,
  commentsRelations,
}

describe('SchemaToRelationsRegister<S>', () => {
  it('produces one entry per relations() declaration, keyed by source table', () => {
    type R = SchemaToRelationsRegister<typeof schema>
    expectTypeOf<keyof R>().toEqualTypeOf<'users' | 'posts' | 'comments'>()
  })

  it('per-table relation map carries `kind` + literal target name', () => {
    type R = SchemaToRelationsRegister<typeof schema>

    expectTypeOf<R['users']['posts']['kind']>().toEqualTypeOf<'many'>()
    expectTypeOf<R['users']['posts']['target']>().toEqualTypeOf<'posts'>()

    expectTypeOf<R['posts']['author']['kind']>().toEqualTypeOf<'one'>()
    expectTypeOf<R['posts']['author']['target']>().toEqualTypeOf<'users'>()

    expectTypeOf<R['posts']['comments']['kind']>().toEqualTypeOf<'many'>()
    expectTypeOf<R['posts']['comments']['target']>().toEqualTypeOf<'comments'>()

    expectTypeOf<R['comments']['post']['kind']>().toEqualTypeOf<'one'>()
    expectTypeOf<R['comments']['post']['target']>().toEqualTypeOf<'posts'>()
  })

  it('schema without any relations() resolves to an empty record', () => {
    const flatSchema = { users, posts }
    type R = SchemaToRelationsRegister<typeof flatSchema>
    // No source tables → no keys.
    expectTypeOf<keyof R>().toEqualTypeOf<never>()
  })

  it('schema with non-relation entries (tables, enums) ignores them', () => {
    const mixed = { users, posts, usersRelations }
    type R = SchemaToRelationsRegister<typeof mixed>
    expectTypeOf<keyof R>().toEqualTypeOf<'users'>()
  })
})
