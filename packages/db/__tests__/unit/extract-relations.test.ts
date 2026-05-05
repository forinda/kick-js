/**
 * Coverage for `extractRelations` — resolves `relations()`
 * declarations into the JSON-serializable sidecar consumed by the
 * relational-query compiler. Spec: docs/db/spec-relational-query.md
 * §5.3.
 *
 * One assertion per spec rule + each error path:
 *   - `one` resolves directly from `fields` / `references`.
 *   - `many` resolves via the inverse `one` (drizzle-style symmetric).
 *   - Missing inverse for `many` throws.
 *   - Alias collision with a column throws.
 *   - Snapshot omits `relations` field when no relations declared.
 *   - `extractSnapshot` wires the sidecar into the snapshot.
 */

import { describe, expect, it } from 'vitest'
import { extractSnapshot } from '../../src/snapshot/extract'
import { extractRelations } from '../../src/query/extract-relations'
import {
  RelationalQueryAliasCollisionError,
  RelationalQueryMissingInverseError,
} from '../../src/query/errors'
import { table, serial, varchar, uuid, integer, type ColumnRef } from '../../src/index'
import { relations } from '../../src/dsl/relations'

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

describe('extractRelations', () => {
  it('resolves `one` relations from fields / references', () => {
    const tables = extractSnapshot({ users, posts, comments }, 'postgres').tables
    const r = extractRelations(
      { users, posts, comments, postsRelations, commentsRelations },
      tables,
    )
    expect(r?.posts?.author).toEqual({
      kind: 'one',
      target: 'users',
      sourceColumns: ['authorId'],
      targetColumns: ['id'],
    })
    expect(r?.comments?.post).toEqual({
      kind: 'one',
      target: 'posts',
      sourceColumns: ['postId'],
      targetColumns: ['id'],
    })
  })

  it('resolves `many` relations via the inverse `one` (flips columns)', () => {
    const tables = extractSnapshot({ users, posts, comments }, 'postgres').tables
    const r = extractRelations(
      { users, posts, comments, usersRelations, postsRelations, commentsRelations },
      tables,
    )
    expect(r?.users?.posts).toEqual({
      kind: 'many',
      target: 'posts',
      sourceColumns: ['id'], // users.id (inverse's references)
      targetColumns: ['authorId'], // posts.authorId (inverse's fields)
    })
    expect(r?.posts?.comments).toEqual({
      kind: 'many',
      target: 'comments',
      sourceColumns: ['id'],
      targetColumns: ['postId'],
    })
  })

  it('falls back to FK introspection when `many` has no inverse but a single FK exists', () => {
    // postsRelations is omitted — `users.posts` has no inverse `one`,
    // but posts has exactly one FK to users (`authorId → users.id`).
    // Fallback should resolve cleanly without an explicit inverse.
    const tables = extractSnapshot({ users, posts }, 'postgres').tables
    const r = extractRelations({ users, posts, usersRelations }, tables)
    expect(r?.users?.posts).toEqual({
      kind: 'many',
      target: 'posts',
      sourceColumns: ['id'],
      targetColumns: ['authorId'],
    })
  })

  it('throws RelationalQueryMissingInverseError when a `many` has no inverse and no FK', () => {
    // Two unrelated tables — `widgets.gadgets` is a `many` with no
    // inverse `one` on `gadgets` AND no FK linking the two. The
    // compiler has no way to derive the join.
    const widgets = table('widgets', { id: serial().primaryKey() })
    const gadgets = table('gadgets', { id: serial().primaryKey() })
    const widgetsRelations = relations(widgets, (h) => ({
      gadgets: h.many(gadgets),
    }))
    const tables = extractSnapshot({ widgets, gadgets }, 'postgres').tables
    expect(() => extractRelations({ widgets, gadgets, widgetsRelations }, tables)).toThrow(
      RelationalQueryMissingInverseError,
    )
  })

  it('throws RelationalQueryAliasCollisionError when relation name shadows a column', () => {
    const collidesTable = table('items', {
      id: serial().primaryKey(),
      owner: varchar(255).notNull(), // ← also a relation name below
      ownerId: uuid()
        .notNull()
        .references(() => users.id),
    })
    const collidesRelations = relations(collidesTable, (h) => ({
      owner: h.one(users, {
        fields: [collidesTable.ownerId],
        references: [users.id],
      }),
    }))
    const tables = extractSnapshot({ users, items: collidesTable }, 'postgres').tables
    expect(() =>
      extractRelations({ users, items: collidesTable, collidesRelations }, tables),
    ).toThrow(RelationalQueryAliasCollisionError)
  })

  it('returns undefined when no relations are declared', () => {
    const tables = extractSnapshot({ users, posts }, 'postgres').tables
    expect(extractRelations({ users, posts }, tables)).toBeUndefined()
  })

  it('extractSnapshot omits `relations` field when no relations declared', () => {
    const snapshot = extractSnapshot({ users, posts }, 'postgres')
    expect(snapshot.relations).toBeUndefined()
  })

  it('extractSnapshot wires resolved relations into the snapshot sidecar', () => {
    const snapshot = extractSnapshot(
      { users, posts, comments, usersRelations, postsRelations, commentsRelations },
      'postgres',
    )
    expect(snapshot.relations).toBeDefined()
    expect(snapshot.relations?.users?.posts?.kind).toBe('many')
    expect(snapshot.relations?.posts?.author?.kind).toBe('one')
    expect(snapshot.relations?.comments?.post?.kind).toBe('one')
  })

  it('handles self-referencing relations (categories.parent / children)', () => {
    type SelfTable = ReturnType<typeof table<'categories', never>> // for ColumnRef compile only
    void undefined as unknown as SelfTable

    const categories = table('categories', {
      id: uuid().primaryKey().defaultRandom(),
      parentId: uuid().references((): ColumnRef => categories.id),
      name: varchar(255).notNull(),
    })
    const categoriesRelations = relations(categories, (h) => ({
      parent: h.one(categories, {
        fields: [categories.parentId],
        references: [categories.id],
      }),
      children: h.many(categories),
    }))
    const tables = extractSnapshot({ categories }, 'postgres').tables
    const r = extractRelations({ categories, categoriesRelations }, tables)
    expect(r?.categories?.parent).toEqual({
      kind: 'one',
      target: 'categories',
      sourceColumns: ['parentId'],
      targetColumns: ['id'],
    })
    expect(r?.categories?.children).toEqual({
      kind: 'many',
      target: 'categories',
      sourceColumns: ['id'],
      targetColumns: ['parentId'],
    })
  })
})
