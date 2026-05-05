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
  RelationalQueryAmbiguousRelationNameError,
  RelationalQueryMissingInverseError,
} from '../../src/query/errors'
import { table, serial, varchar, uuid, integer, text, type ColumnRef } from '../../src/index'
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

describe('extractRelations — relationName multi-FK disambiguation (M4.B)', () => {
  // Topology: messages with two FKs to users — sender + recipient.
  // Without `relationName`, the resolver can't pick the right inverse.
  const messages = table('messages', {
    id: uuid().primaryKey().defaultRandom(),
    senderId: uuid()
      .notNull()
      .references(() => users.id),
    recipientId: uuid()
      .notNull()
      .references(() => users.id),
    body: text().notNull(),
  })

  it('resolves a paired (one + many) match by relationName', () => {
    const messagesRels = relations(messages, (h) => ({
      sender: h.one(users, {
        fields: [messages.senderId],
        references: [users.id],
        relationName: 'sentMessages',
      }),
      recipient: h.one(users, {
        fields: [messages.recipientId],
        references: [users.id],
        relationName: 'receivedMessages',
      }),
    }))
    const usersRels = relations(users, (h) => ({
      sentMessages: h.many(messages, { relationName: 'sentMessages' }),
      receivedMessages: h.many(messages, { relationName: 'receivedMessages' }),
    }))

    const tables = extractSnapshot({ users, messages }, 'postgres').tables
    const r = extractRelations({ users, messages, messagesRels, usersRels }, tables)

    expect(r?.users?.sentMessages).toEqual({
      kind: 'many',
      target: 'messages',
      sourceColumns: ['id'],
      targetColumns: ['senderId'],
      relationName: 'sentMessages',
    })
    expect(r?.users?.receivedMessages).toEqual({
      kind: 'many',
      target: 'messages',
      sourceColumns: ['id'],
      targetColumns: ['recipientId'],
      relationName: 'receivedMessages',
    })
  })

  it('preserves relationName on the `one` side as well', () => {
    const messagesRels = relations(messages, (h) => ({
      sender: h.one(users, {
        fields: [messages.senderId],
        references: [users.id],
        relationName: 'sentMessages',
      }),
    }))
    const tables = extractSnapshot({ users, messages }, 'postgres').tables
    const r = extractRelations({ users, messages, messagesRels }, tables)
    expect(r?.messages?.sender).toEqual({
      kind: 'one',
      target: 'users',
      sourceColumns: ['senderId'],
      targetColumns: ['id'],
      relationName: 'sentMessages',
    })
  })

  it('throws RelationalQueryAmbiguousRelationNameError when two `one`s share the same tag back to the source', () => {
    // Two `one`s on `messages` both pointing to `users` with the
    // same `relationName` is operator error.
    const messagesRels = relations(messages, (h) => ({
      sender: h.one(users, {
        fields: [messages.senderId],
        references: [users.id],
        relationName: 'sentMessages',
      }),
      // Operator error: same relationName as `sender`.
      recipient: h.one(users, {
        fields: [messages.recipientId],
        references: [users.id],
        relationName: 'sentMessages',
      }),
    }))
    const usersRels = relations(users, (h) => ({
      sentMessages: h.many(messages, { relationName: 'sentMessages' }),
    }))
    const tables = extractSnapshot({ users, messages }, 'postgres').tables
    expect(() => extractRelations({ users, messages, messagesRels, usersRels }, tables)).toThrow(
      RelationalQueryAmbiguousRelationNameError,
    )
  })

  it('throws MissingInverseError when multi-FK `many` has no relationName tag', () => {
    // M4.B tightens the M3 first-match heuristic. Two FKs on
    // messages → users without relationName is now an error.
    const messagesRels = relations(messages, (h) => ({
      sender: h.one(users, {
        fields: [messages.senderId],
        references: [users.id],
      }),
      recipient: h.one(users, {
        fields: [messages.recipientId],
        references: [users.id],
      }),
    }))
    const usersRels = relations(users, (h) => ({
      anyMessages: h.many(messages),
    }))
    const tables = extractSnapshot({ users, messages }, 'postgres').tables
    expect(() => extractRelations({ users, messages, messagesRels, usersRels }, tables)).toThrow(
      RelationalQueryMissingInverseError,
    )
  })

  it('falls through to step-2 when only the source side declares relationName', () => {
    // `usersRels.sentMessages` declares the tag; `messagesRels.sender`
    // doesn't. Step 1 finds zero matches (no inverse with the same
    // tag), falls through. Step 2 finds one untagged inverse —
    // pairs them anyway. Slightly forgiving on the typo case.
    const messagesRels = relations(messages, (h) => ({
      sender: h.one(users, {
        fields: [messages.senderId],
        references: [users.id],
      }),
    }))
    const usersRels = relations(users, (h) => ({
      sentMessages: h.many(messages, { relationName: 'sentMessages' }),
    }))
    const tables = extractSnapshot({ users, messages }, 'postgres').tables
    const r = extractRelations({ users, messages, messagesRels, usersRels }, tables)
    expect(r?.users?.sentMessages?.target).toBe('messages')
  })

  it('preserves empty-string relationName (presence-based, not truthiness-based)', () => {
    // Edge case: `relationName: ''` is a legal-but-weird tag. The
    // resolver uses `!== undefined` checks rather than truthy spread
    // so empty strings round-trip correctly. This locks the
    // M4.A.2 PR review fix against future regression.
    const messagesRels = relations(messages, (h) => ({
      sender: h.one(users, {
        fields: [messages.senderId],
        references: [users.id],
        relationName: '',
      }),
    }))
    const usersRels = relations(users, (h) => ({
      sentMessages: h.many(messages, { relationName: '' }),
    }))
    const tables = extractSnapshot({ users, messages }, 'postgres').tables
    const r = extractRelations({ users, messages, messagesRels, usersRels }, tables)
    // Source-side tag preserved on the resolved entry.
    expect(r?.users?.sentMessages?.relationName).toBe('')
    // Inverse-side tag preserved on the `one` entry too.
    expect(r?.messages?.sender?.relationName).toBe('')
  })

  it('reuses the same relationName string across unrelated table pairs (per-pair scope)', () => {
    // R-2 scope clarification: `'audit'` as a tag on (workspaces,
    // audit-logs) and (projects, audit-logs) is fine — duplicates
    // only matter within (sourceTable, targetTable, relationName).
    const workspaces = table('workspaces', { id: uuid().primaryKey() })
    const projects = table('projects', { id: uuid().primaryKey() })
    const auditLogs = table('audit_logs', {
      id: uuid().primaryKey(),
      workspaceId: uuid()
        .notNull()
        .references(() => workspaces.id),
      projectId: uuid()
        .notNull()
        .references(() => projects.id),
    })

    const auditRels = relations(auditLogs, (h) => ({
      workspace: h.one(workspaces, {
        fields: [auditLogs.workspaceId],
        references: [workspaces.id],
        relationName: 'audit',
      }),
      project: h.one(projects, {
        fields: [auditLogs.projectId],
        references: [projects.id],
        relationName: 'audit',
      }),
    }))
    const workspaceRels = relations(workspaces, (h) => ({
      auditLogs: h.many(auditLogs, { relationName: 'audit' }),
    }))
    const projectRels = relations(projects, (h) => ({
      auditLogs: h.many(auditLogs, { relationName: 'audit' }),
    }))

    const tables = extractSnapshot(
      { workspaces, projects, audit_logs: auditLogs },
      'postgres',
    ).tables
    const r = extractRelations(
      { workspaces, projects, audit_logs: auditLogs, auditRels, workspaceRels, projectRels },
      tables,
    )
    // Each side resolves cleanly because the (source, target,
    // relationName) triple is unique per pair.
    expect(r?.workspaces?.auditLogs?.targetColumns).toEqual(['workspaceId'])
    expect(r?.projects?.auditLogs?.targetColumns).toEqual(['projectId'])
  })
})
