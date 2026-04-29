// Coverage for `$extends({ result })`.
//
// The plugin's two halves (transformQuery for needs-injection,
// transformResult for compute application) are tested directly via
// fake AST nodes + envelope args, then end-to-end through a Kysely
// instance with a stub driver that returns canned rows. The stub
// driver lets us hit the post-fetch transform without standing up a
// real database.

import { describe, expect, it } from 'vitest'
import {
  ColumnNode,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  ReferenceNode,
  SelectAllNode,
  SelectionNode,
  TableNode,
  type Dialect,
  type DatabaseConnection,
  type QueryResult,
  type UnknownRow,
} from 'kysely'

import { createDbClient, table, serial, varchar } from '../../src/index'
import { ResultExtensionPlugin } from '../../src/extend/result-plugin'

// ── Fixture schema ─────────────────────────────────────────────

const posts = table('posts', {
  id: serial().primaryKey(),
  slug: varchar(100).notNull(),
  title: varchar(255).notNull(),
})

// ── Stub dialect — driver returns whatever rows are queued ─────

function dialectReturning(rows: UnknownRow[]): Dialect {
  const conn: DatabaseConnection = {
    executeQuery: async <R>(): Promise<QueryResult<R>> => ({ rows: rows as unknown as R[] }),
    streamQuery: async function* () {
      // unused
      yield { rows: [] as never[] }
    },
  }
  return {
    createAdapter: () => new PostgresAdapter(),
    createDriver: () => ({
      init: async () => {},
      acquireConnection: async () => conn,
      beginTransaction: async () => {},
      commitTransaction: async () => {},
      rollbackTransaction: async () => {},
      releaseConnection: async () => {},
      destroy: async () => {},
    }),
    createIntrospector: (db) => new PostgresIntrospector(db),
    createQueryCompiler: () => new PostgresQueryCompiler(),
  }
}

// ── Plugin unit tests ──────────────────────────────────────────

describe('ResultExtensionPlugin — transformQuery (needs-injection)', () => {
  const fakeQueryId = (id: string) => ({ queryId: id }) as never

  it('injects missing `needs` columns into a partial SELECT', () => {
    const plugin = new ResultExtensionPlugin({
      posts: {
        url: {
          needs: { id: true, slug: true },
          compute: () => '',
        },
      },
    })
    // `select(['title'])` — id + slug must be auto-added.
    const node = {
      kind: 'SelectQueryNode',
      from: { kind: 'FromNode', froms: [TableNode.create('posts')] },
      selections: [
        SelectionNode.create(ReferenceNode.create(ColumnNode.create('title'))),
      ],
    } as never

    const out = plugin.transformQuery({ node, queryId: fakeQueryId('q1') })
    const sels = (out as { selections: ReadonlyArray<SelectionNode> }).selections
    const cols = sels.map((s) => {
      const inner = s.selection
      if (ReferenceNode.is(inner) && ColumnNode.is(inner.column)) return inner.column.column.name
      return null
    })
    expect(cols).toContain('title')
    expect(cols).toContain('id')
    expect(cols).toContain('slug')
  })

  it('skips injection when select uses SelectAllNode (`select *`)', () => {
    const plugin = new ResultExtensionPlugin({
      posts: {
        url: { needs: { id: true }, compute: () => '' },
      },
    })
    const node = {
      kind: 'SelectQueryNode',
      from: { kind: 'FromNode', froms: [TableNode.create('posts')] },
      selections: [SelectionNode.createSelectAll()],
    } as never

    const out = plugin.transformQuery({ node, queryId: fakeQueryId('q2') })
    // No additional selections — wildcard already covers everything.
    expect((out as typeof node).selections).toHaveLength(1)
  })

  it('does not duplicate columns already present in the SELECT', () => {
    const plugin = new ResultExtensionPlugin({
      posts: {
        url: { needs: { id: true, slug: true }, compute: () => '' },
      },
    })
    const node = {
      kind: 'SelectQueryNode',
      from: { kind: 'FromNode', froms: [TableNode.create('posts')] },
      selections: [
        SelectionNode.create(ReferenceNode.create(ColumnNode.create('id'))),
        SelectionNode.create(ReferenceNode.create(ColumnNode.create('title'))),
      ],
    } as never
    const out = plugin.transformQuery({ node, queryId: fakeQueryId('q3') })
    const sels = (out as { selections: ReadonlyArray<SelectionNode> }).selections
    const ids = sels.filter((s) => {
      const inner = s.selection
      return (
        ReferenceNode.is(inner) &&
        ColumnNode.is(inner.column) &&
        inner.column.column.name === 'id'
      )
    })
    expect(ids).toHaveLength(1) // one, not two
  })

  it('passes through joined / multi-from selects untouched', () => {
    const plugin = new ResultExtensionPlugin({
      posts: { url: { needs: { id: true }, compute: () => '' } },
    })
    const node = {
      kind: 'SelectQueryNode',
      from: {
        kind: 'FromNode',
        froms: [TableNode.create('posts'), TableNode.create('users')],
      },
      selections: [SelectionNode.createSelectAll()],
    } as never
    const out = plugin.transformQuery({ node, queryId: fakeQueryId('q4') })
    expect(out).toBe(node)
  })

  it('passes through tables without a registered extension', () => {
    const plugin = new ResultExtensionPlugin({
      posts: { url: { needs: { id: true }, compute: () => '' } },
    })
    const node = {
      kind: 'SelectQueryNode',
      from: { kind: 'FromNode', froms: [TableNode.create('users')] },
      selections: [SelectionNode.createSelectAll()],
    } as never
    const out = plugin.transformQuery({ node, queryId: fakeQueryId('q5') })
    expect(out).toBe(node)
  })

  it('passes through non-select root nodes', () => {
    const plugin = new ResultExtensionPlugin({
      posts: { url: { needs: { id: true }, compute: () => '' } },
    })
    const insertNode = { kind: 'InsertQueryNode' } as never
    expect(plugin.transformQuery({ node: insertNode, queryId: fakeQueryId('q6') })).toBe(
      insertNode,
    )
  })
})

// ── End-to-end through a Kysely instance ───────────────────────

describe('createDbClient + $extends({ result }) — end-to-end', () => {
  it('applies compute() to every selected row', async () => {
    const dialect = dialectReturning([
      { id: 1, slug: 'hello', title: 'Hello' },
      { id: 2, slug: 'world', title: 'World' },
    ])

    const db = createDbClient({ schema: { posts }, dialect })
    const dbX = db.$extends({
      result: {
        posts: {
          url: {
            needs: { id: true, slug: true },
            compute: (row) => `/posts/${row.id}/${row.slug}`,
          },
        },
      },
    })
    const rows = await dbX.selectFrom('posts').selectAll().execute()
    expect(rows).toHaveLength(2)
    expect((rows[0] as { url: string }).url).toBe('/posts/1/hello')
    expect((rows[1] as { url: string }).url).toBe('/posts/2/world')
    await dbX.destroy()
  })

  it('preserves the non-computed columns alongside the computed property', async () => {
    const dialect = dialectReturning([{ id: 7, slug: 'x', title: 'X' }])
    const db = createDbClient({ schema: { posts }, dialect })
    const dbX = db.$extends({
      result: {
        posts: { length: { needs: { title: true }, compute: (r) => (r.title as string).length } },
      },
    })
    const row = await dbX.selectFrom('posts').selectAll().executeTakeFirst()
    expect(row).toMatchObject({ id: 7, slug: 'x', title: 'X', length: 1 })
    await dbX.destroy()
  })

  it('multiple computeds on the same table all apply', async () => {
    const dialect = dialectReturning([{ id: 3, slug: 'a', title: 'Hi' }])
    const db = createDbClient({ schema: { posts }, dialect })
    const dbX = db.$extends({
      result: {
        posts: {
          url: { needs: { id: true, slug: true }, compute: (r) => `/p/${r.id}` },
          shouty: { needs: { title: true }, compute: (r) => `${r.title}!` },
        },
      },
    })
    const row = (await dbX.selectFrom('posts').selectAll().executeTakeFirst()) as {
      url: string
      shouty: string
    }
    expect(row.url).toBe('/p/3')
    expect(row.shouty).toBe('Hi!')
    await dbX.destroy()
  })

  it('compute throwing degrades to undefined on that row, sibling computeds still fire', async () => {
    const dialect = dialectReturning([{ id: 4, slug: 'b', title: 'Z' }])
    const db = createDbClient({ schema: { posts }, dialect })
    const dbX = db.$extends({
      result: {
        posts: {
          boom: {
            needs: { id: true },
            compute: () => {
              throw new Error('compute failed')
            },
          },
          ok: { needs: { slug: true }, compute: (r) => `slug:${r.slug}` },
        },
      },
    })
    const row = (await dbX.selectFrom('posts').selectAll().executeTakeFirst()) as {
      boom: unknown
      ok: string
    }
    expect(row.boom).toBeUndefined()
    expect(row.ok).toBe('slug:b')
    await dbX.destroy()
  })

  it('non-extended tables stay untouched', async () => {
    // Schema with two tables; only `posts` has computeds. Selecting
    // from `users` shouldn't get any computed properties.
    const users = table('users', {
      id: serial().primaryKey(),
      email: varchar(255).notNull(),
    })
    const dialect = dialectReturning([{ id: 1, email: 'a@b.com' }])
    const db = createDbClient({ schema: { posts, users }, dialect })
    const dbX = db.$extends({
      result: {
        posts: { url: { needs: { id: true }, compute: () => '/p/x' } },
      },
    })
    const row = await dbX.selectFrom('users').selectAll().executeTakeFirst()
    expect(row).toEqual({ id: 1, email: 'a@b.com' })
    expect(row).not.toHaveProperty('url')
    await dbX.destroy()
  })

  it('falls through to the proxy-only path when no result extensions present', async () => {
    const dialect = dialectReturning([{ id: 1, slug: 's', title: 't' }])
    const db = createDbClient({ schema: { posts }, dialect })
    const dbX = db.$extends({
      model: {
        posts: {
          firstId() {
            return 42
          },
        },
      },
    })
    // Model methods still attach via the proxy; no result transform
    // wraps the SELECT path.
    expect((dbX as { posts: { firstId(): number } }).posts.firstId()).toBe(42)
    const row = await dbX.selectFrom('posts').selectAll().executeTakeFirst()
    expect(row).toEqual({ id: 1, slug: 's', title: 't' })
    expect(row).not.toHaveProperty('url')
    await dbX.destroy()
  })

  it('result + model can compose in a single $extends call', async () => {
    const dialect = dialectReturning([{ id: 9, slug: 'k', title: 'K' }])
    const db = createDbClient({ schema: { posts }, dialect })
    const dbX = db.$extends({
      model: {
        posts: {
          tag() {
            return 'posts-model'
          },
        },
      },
      result: {
        posts: { tag2: { needs: { id: true }, compute: (r) => `c:${r.id}` } },
      },
    })
    expect((dbX as { posts: { tag(): string } }).posts.tag()).toBe('posts-model')
    const row = (await dbX.selectFrom('posts').selectAll().executeTakeFirst()) as {
      tag2: string
    }
    expect(row.tag2).toBe('c:9')
    await dbX.destroy()
  })
})
