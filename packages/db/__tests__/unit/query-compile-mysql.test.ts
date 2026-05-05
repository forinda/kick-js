/**
 * Snapshot SQL tests for the MySQL relational-query compiler.
 *
 * Mirror of `query-compile-sqlite.test.ts` but with MySQL-flavored
 * SQL — `json_arrayagg` + `json_object` wrapped in
 * `cast(... as json)`, backtick identifiers, no LATERAL.
 *
 * Spec: docs/db/spec-relational-query-other-dialects.md §3.2.
 */

import { describe, expect, it } from 'vitest'
import { DummyDriver, Kysely, MysqlAdapter, MysqlIntrospector, MysqlQueryCompiler } from 'kysely'
import { compileMysql } from '../../src/query/compile-mysql'
import {
  RelationalQueryDepthError,
  RelationalQueryUnknownRelationError,
} from '../../src/query/errors'
import type { ResolvedRelations } from '../../src/query/relations'
import type { TableSnapshot } from '../../src/snapshot/types'

interface FixtureDB {
  users: { id: string; email: string; isActive: boolean; createdAt: Date }
  posts: { id: string; authorId: string; title: string; publishedAt: Date | null }
  comments: { id: string; postId: string; body: string }
  categories: { id: string; parentId: string | null; name: string }
}

function makeDb(): Kysely<FixtureDB> {
  return new Kysely<FixtureDB>({
    dialect: {
      createAdapter: () => new MysqlAdapter(),
      createDriver: () => new DummyDriver(),
      createIntrospector: (db) => new MysqlIntrospector(db),
      createQueryCompiler: () => new MysqlQueryCompiler(),
    },
  })
}

function col(): TableSnapshot['columns'][string] {
  return { name: '', type: 'text', nullable: true, default: null, primaryKey: false }
}
const TABLES: Record<string, TableSnapshot> = {
  users: {
    name: 'users',
    columns: { id: col(), email: col(), isActive: col(), createdAt: col() },
    indexes: [],
    foreignKeys: [],
    checks: [],
  },
  posts: {
    name: 'posts',
    columns: { id: col(), authorId: col(), title: col(), publishedAt: col() },
    indexes: [],
    foreignKeys: [],
    checks: [],
  },
  comments: {
    name: 'comments',
    columns: { id: col(), postId: col(), body: col() },
    indexes: [],
    foreignKeys: [],
    checks: [],
  },
  categories: {
    name: 'categories',
    columns: { id: col(), parentId: col(), name: col() },
    indexes: [],
    foreignKeys: [],
    checks: [],
  },
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

describe('compileMysql — happy path', () => {
  it('bare findMany emits a flat selectAll with depth-0 alias', () => {
    const db = makeDb()
    const { sql, parameters } = compileMysql(db, 'users', {}, RELATIONS, TABLES)
    expect(sql).toBe('select * from `users` as `users_0`')
    expect(parameters).toEqual([])
  })

  it('1-deep many uses json_arrayagg + json_object + cast(... as json)', () => {
    const db = makeDb()
    const { sql } = compileMysql(db, 'users', { with: { posts: true } }, RELATIONS, TABLES)
    // MySQL primitives — must NOT contain PG's json_agg or
    // SQLite's json_group_array.
    expect(sql).toContain('json_arrayagg')
    expect(sql).toContain('json_object')
    expect(sql).toContain('as json')
    expect(sql).not.toContain('json_agg')
    expect(sql).not.toContain('json_group_array')
    // Correlated subquery on aliased tables (backtick-quoted).
    expect(sql).toContain('`posts_1`.`authorId` = `users_0`.`id`')
    expect(sql).toContain('as `posts`')
  })

  it('1-deep one — comments { with: { post: true } } uses json_object + LIMIT 1', () => {
    const db = makeDb()
    const { sql } = compileMysql(db, 'comments', { with: { post: true } }, RELATIONS, TABLES)
    expect(sql).toContain('json_object')
    expect(sql).toContain('`posts_1`.`id` = `comments_0`.`postId`')
    expect(sql).toContain('limit ?')
  })

  it('2-deep many → many — users → posts → comments', () => {
    const db = makeDb()
    const { sql } = compileMysql(
      db,
      'users',
      { with: { posts: { with: { comments: true } } } },
      RELATIONS,
      TABLES,
    )
    const matches = sql.match(/json_arrayagg/g) ?? []
    expect(matches.length).toBe(2)
    expect(sql).toContain('`comments_2`.`postId` = `posts_1`.`id`')
    expect(sql).toContain('`posts_1`.`authorId` = `users_0`.`id`')
  })

  it('self-reference — depth-suffixed aliases per level', () => {
    const db = makeDb()
    const { sql } = compileMysql(
      db,
      'categories',
      { with: { children: { with: { children: true } } } },
      RELATIONS,
      TABLES,
    )
    expect(sql).toContain('from `categories` as `categories_0`')
    expect(sql).toContain('from `categories` as `categories_1`')
    expect(sql).toContain('from `categories` as `categories_2`')
    expect(sql).toContain('`categories_1`.`parentId` = `categories_0`.`id`')
    expect(sql).toContain('`categories_2`.`parentId` = `categories_1`.`id`')
  })

  it('per-relation where parametrizes correctly', () => {
    const db = makeDb()
    const since = new Date('2026-01-01T00:00:00.000Z')
    const { sql, parameters } = compileMysql(
      db,
      'users',
      {
        with: {
          posts: {
            where: (_p, eb) => eb('publishedAt', '>=', since),
          },
        },
      },
      RELATIONS,
      TABLES,
    )
    expect(sql).toContain('`publishedAt` >= ?')
    expect(parameters).toEqual([since])
  })

  it('per-relation limit clamps the inner sub-select', () => {
    const db = makeDb()
    const { sql, parameters } = compileMysql(
      db,
      'users',
      { with: { posts: { limit: 5 } } },
      RELATIONS,
      TABLES,
    )
    expect(sql).toContain('limit ?')
    expect(parameters).toEqual([5])
  })

  it('outer where + orderBy + limit + offset all flow through', () => {
    const db = makeDb()
    const { sql, parameters } = compileMysql(
      db,
      'users',
      {
        where: (_u, eb) => eb('isActive', '=', true),
        orderBy: (_u, eb) => eb.ref('createdAt'),
        limit: 20,
        offset: 5,
      },
      RELATIONS,
      TABLES,
    )
    expect(sql).toContain('where `isActive` = ?')
    expect(sql).toContain('order by `createdAt`')
    expect(sql).toContain('limit ?')
    expect(sql).toContain('offset ?')
    expect(parameters).toEqual([true, 20, 5])
  })

  it('mode=first adds LIMIT 1 to the outer query', () => {
    const db = makeDb()
    const { sql, parameters } = compileMysql(db, 'users', {}, RELATIONS, TABLES, 'first')
    expect(sql).toBe('select * from `users` as `users_0` limit ?')
    expect(parameters).toEqual([1])
  })

  it('mode=unique adds LIMIT 1', () => {
    const db = makeDb()
    const { sql, parameters } = compileMysql(db, 'users', {}, RELATIONS, TABLES, 'unique')
    expect(sql).toBe('select * from `users` as `users_0` limit ?')
    expect(parameters).toEqual([1])
  })

  it('explicit limit overrides the implicit `first` LIMIT 1', () => {
    const db = makeDb()
    const { sql, parameters } = compileMysql(db, 'users', { limit: 10 }, RELATIONS, TABLES, 'first')
    expect(sql).toContain('limit ?')
    expect(parameters).toEqual([10])
  })
})

describe('compileMysql — error paths', () => {
  it('unknown relation throws RelationalQueryUnknownRelationError', () => {
    const db = makeDb()
    expect(() =>
      compileMysql(db, 'users', { with: { nonsense: true } as never }, RELATIONS, TABLES),
    ).toThrow(RelationalQueryUnknownRelationError)
  })

  it('exceeding maxDepth throws RelationalQueryDepthError', () => {
    const db = makeDb()
    expect(() =>
      compileMysql(
        db,
        'categories',
        {
          maxDepth: 1,
          with: { children: { with: { children: true } } },
        },
        RELATIONS,
        TABLES,
      ),
    ).toThrow(RelationalQueryDepthError)
  })
})
