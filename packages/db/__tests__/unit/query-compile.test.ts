/**
 * Snapshot SQL tests for the PG relational-query compiler.
 *
 * One fixture per topology in spec-relational-query.md §3.3 + the
 * error-path coverage from §6 / §7. Builds against a Kysely instance
 * with `DummyDriver` so the test never opens a connection — we only
 * assert the compiled `{ sql, parameters }`.
 */

import { describe, expect, it } from 'vitest'
import {
  DummyDriver,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
} from 'kysely'
import { compilePg } from '../../src/query/compile-pg'
import {
  RelationalQueryDepthError,
  RelationalQueryUnknownRelationError,
} from '../../src/query/errors'
import type { ResolvedRelations } from '../../src/query/relations'

interface FixtureDB {
  users: { id: string; email: string; isActive: boolean; createdAt: Date }
  posts: { id: string; authorId: string; title: string; publishedAt: Date | null }
  comments: { id: string; postId: string; body: string }
  categories: { id: string; parentId: string | null; name: string }
}

function makeDb(): Kysely<FixtureDB> {
  return new Kysely<FixtureDB>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => new DummyDriver(),
      createIntrospector: (db) => new PostgresIntrospector(db),
      createQueryCompiler: () => new PostgresQueryCompiler(),
    },
  })
}

const RELATIONS: ResolvedRelations = {
  users: {
    posts: {
      kind: 'many',
      target: 'posts',
      sourceColumns: ['id'],
      targetColumns: ['authorId'],
    },
  },
  posts: {
    author: {
      kind: 'one',
      target: 'users',
      sourceColumns: ['authorId'],
      targetColumns: ['id'],
    },
    comments: {
      kind: 'many',
      target: 'comments',
      sourceColumns: ['id'],
      targetColumns: ['postId'],
    },
  },
  comments: {
    post: {
      kind: 'one',
      target: 'posts',
      sourceColumns: ['postId'],
      targetColumns: ['id'],
    },
  },
  categories: {
    parent: {
      kind: 'one',
      target: 'categories',
      sourceColumns: ['parentId'],
      targetColumns: ['id'],
    },
    children: {
      kind: 'many',
      target: 'categories',
      sourceColumns: ['id'],
      targetColumns: ['parentId'],
    },
  },
}

describe('compilePg — happy path', () => {
  it('bare findMany emits a flat selectAll with depth-0 alias', () => {
    const db = makeDb()
    const { sql, parameters } = compilePg(db, 'users', {}, RELATIONS)
    expect(sql).toBe('select * from "users" as "users_0"')
    expect(parameters).toEqual([])
  })

  it('1-deep many — users { with: { posts: true } }', () => {
    const db = makeDb()
    const { sql } = compilePg(db, 'users', { with: { posts: true } }, RELATIONS)
    expect(sql).toContain("select coalesce(json_agg(agg), '[]') from")
    expect(sql).toContain('from "posts" as "posts_1"')
    expect(sql).toContain('"posts_1"."authorId" = "users_0"."id"')
    expect(sql).toContain('as "posts"')
  })

  it('1-deep one — comments { with: { post: true } } uses to_json + LIMIT 1', () => {
    const db = makeDb()
    const { sql } = compilePg(db, 'comments', { with: { post: true } }, RELATIONS)
    expect(sql).toContain('select to_json(obj) from')
    expect(sql).toContain('from "posts" as "posts_1"')
    expect(sql).toContain('"posts_1"."id" = "comments_0"."postId"')
    expect(sql).toContain('limit $1')
  })

  it('2-deep many → many — users → posts → comments', () => {
    const db = makeDb()
    const { sql } = compilePg(
      db,
      'users',
      { with: { posts: { with: { comments: true } } } },
      RELATIONS,
    )
    // Outer json_agg over posts; inner json_agg over comments.
    const matches = sql.match(/json_agg/g) ?? []
    expect(matches.length).toBe(2)
    expect(sql).toContain('"comments_2"."postId" = "posts_1"."id"')
    expect(sql).toContain('"posts_1"."authorId" = "users_0"."id"')
  })

  it('2-deep one → many — comments → post → comments (cycle on post)', () => {
    const db = makeDb()
    const { sql } = compilePg(
      db,
      'comments',
      { with: { post: { with: { comments: true } } } },
      RELATIONS,
    )
    expect(sql).toContain('to_json(obj)')
    expect(sql).toContain('json_agg(agg)')
    // Outer comments_0, inner comments_2 (on post_1) — distinct
    // aliases per level keep the cycle's correlation correct.
    expect(sql).toContain('from "comments" as "comments_0"')
    expect(sql).toContain('from "comments" as "comments_2"')
  })

  it('self-reference — categories { with: { children: { with: { children: true } } } }', () => {
    const db = makeDb()
    const { sql } = compilePg(
      db,
      'categories',
      { with: { children: { with: { children: true } } } },
      RELATIONS,
    )
    // Three distinct depth-suffixed aliases — outer, child, grandchild.
    expect(sql).toContain('from "categories" as "categories_0"')
    expect(sql).toContain('from "categories" as "categories_1"')
    expect(sql).toContain('from "categories" as "categories_2"')
    // Correlation walks each level: child → outer, grandchild → child.
    expect(sql).toContain('"categories_1"."parentId" = "categories_0"."id"')
    expect(sql).toContain('"categories_2"."parentId" = "categories_1"."id"')
    expect(sql.match(/json_agg/g)?.length).toBe(2)
  })

  it('per-relation where parametrizes correctly', () => {
    const db = makeDb()
    const publishedAt = new Date('2026-01-01T00:00:00.000Z')
    const { sql, parameters } = compilePg(
      db,
      'users',
      {
        with: {
          posts: {
            where: (p, eb) => eb('publishedAt', '>=', publishedAt),
          },
        },
      },
      RELATIONS,
    )
    expect(sql).toContain('"publishedAt" >= $1')
    expect(parameters).toEqual([publishedAt])
  })

  it('per-relation limit clamps the inner sub-select', () => {
    const db = makeDb()
    const { sql, parameters } = compilePg(db, 'users', { with: { posts: { limit: 5 } } }, RELATIONS)
    expect(sql).toContain('limit $1')
    expect(parameters).toEqual([5])
  })

  it('outer where + orderBy + limit + offset all flow through', () => {
    const db = makeDb()
    const { sql, parameters } = compilePg(
      db,
      'users',
      {
        where: (_u, eb) => eb('isActive', '=', true),
        orderBy: (_u, eb) => eb.ref('createdAt'),
        limit: 20,
        offset: 5,
      },
      RELATIONS,
    )
    expect(sql).toContain('where "isActive" = $1')
    expect(sql).toContain('order by "createdAt"')
    expect(sql).toContain('limit $2')
    expect(sql).toContain('offset $3')
    expect(parameters).toEqual([true, 20, 5])
  })

  it('mode=first adds LIMIT 1 to the outer query', () => {
    const db = makeDb()
    const { sql, parameters } = compilePg(db, 'users', {}, RELATIONS, 'first')
    expect(sql).toBe('select * from "users" as "users_0" limit $1')
    expect(parameters).toEqual([1])
  })

  it('mode=unique adds LIMIT 1 to the outer query', () => {
    const db = makeDb()
    const { sql, parameters } = compilePg(db, 'users', {}, RELATIONS, 'unique')
    expect(sql).toBe('select * from "users" as "users_0" limit $1')
    expect(parameters).toEqual([1])
  })

  it('explicit limit overrides the implicit `first` LIMIT 1', () => {
    const db = makeDb()
    const { sql, parameters } = compilePg(db, 'users', { limit: 10 }, RELATIONS, 'first')
    expect(sql).toContain('limit $1')
    expect(parameters).toEqual([10])
  })
})

describe('compilePg — error paths', () => {
  it('unknown relation throws RelationalQueryUnknownRelationError', () => {
    const db = makeDb()
    expect(() => compilePg(db, 'users', { with: { nonsense: true } as never }, RELATIONS)).toThrow(
      RelationalQueryUnknownRelationError,
    )
  })

  it('exceeding maxDepth throws RelationalQueryDepthError', () => {
    const db = makeDb()
    expect(() =>
      compilePg(
        db,
        'categories',
        {
          maxDepth: 1,
          with: { children: { with: { children: true } } },
        },
        RELATIONS,
      ),
    ).toThrow(RelationalQueryDepthError)
  })

  it('default maxDepth (5) accepts 5 levels of self-reference', () => {
    const db = makeDb()
    // 5 levels: categories → children → children → children → children → children (5 nestings)
    const w = {
      with: {
        children: { with: { children: { with: { children: { with: { children: true } } } } } },
      },
    } as const
    expect(() => compilePg(db, 'categories', w, RELATIONS)).not.toThrow()
  })

  it('default maxDepth rejects 6 levels of self-reference', () => {
    const db = makeDb()
    const w = {
      with: {
        children: {
          with: {
            children: {
              with: {
                children: {
                  with: {
                    children: { with: { children: { with: { children: true } } } },
                  },
                },
              },
            },
          },
        },
      },
    } as const
    expect(() => compilePg(db, 'categories', w, RELATIONS)).toThrow(RelationalQueryDepthError)
  })
})
