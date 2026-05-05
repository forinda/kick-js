/**
 * Type-level coverage for `db.query.X.findMany({ with })` —
 * spec-relational-query.md §3.3 expectTypeOf matrix.
 *
 * The test file owns the global `KickDbRegister` +
 * `KickDbRelationsRegister` augmentations for this run: a 4-table
 * fixture (users / posts / comments / categories) declared inline
 * here and augmented onto both registries. Runtime asserts only —
 * no DB connection, no schema instance.
 */

import { describe, expectTypeOf, it } from 'vitest'
import type { Generated } from 'kysely'
import type { FindManyOptions, FindManyRow } from '../../src/query/types'

// ── Fixture DB shape ────────────────────────────────────────────────────
interface FixtureDB {
  users: {
    id: Generated<string>
    email: string
    isActive: boolean
  }
  posts: {
    id: Generated<string>
    authorId: string
    title: string
    publishedAt: Date | null
  }
  comments: {
    id: Generated<string>
    postId: string
    body: string
  }
  categories: {
    id: Generated<string>
    parentId: string | null
    name: string
  }
}

// ── Augment both registries ─────────────────────────────────────────────
declare module '../../src/client/register' {
  interface KickDbRegister {
    db: { qb: import('kysely').Kysely<FixtureDB> }
  }
}

declare module '../../src/query/types' {
  interface KickDbRelationsRegister {
    db: {
      users: {
        posts: { kind: 'many'; target: 'posts' }
      }
      posts: {
        author: { kind: 'one'; target: 'users' }
        comments: { kind: 'many'; target: 'comments' }
      }
      comments: {
        post: { kind: 'one'; target: 'posts' }
      }
      categories: {
        parent: { kind: 'one'; target: 'categories' }
        children: { kind: 'many'; target: 'categories' }
      }
    }
  }
}

// Helper: resolve FindManyRow for a given options literal.
type Row<
  T extends 'users' | 'posts' | 'comments' | 'categories',
  O extends FindManyOptions<T>,
> = FindManyRow<T, O>

describe('FindManyRow — spec §3.3 expectTypeOf matrix', () => {
  it('T-1-deep-many — users.findMany({ with: { posts: true } })', () => {
    type R = Row<'users', { with: { posts: true } }>
    expectTypeOf<R>().toMatchTypeOf<FixtureDB['users'] & { posts: FixtureDB['posts'][] }>()
  })

  it('T-1-deep-one — comments.findMany({ with: { post: true } }) → post is nullable', () => {
    type R = Row<'comments', { with: { post: true } }>
    expectTypeOf<R>().toMatchTypeOf<FixtureDB['comments'] & { post: FixtureDB['posts'] | null }>()
  })

  it('T-2-many-many — users.findMany({ with: { posts: { with: { comments: true } } } })', () => {
    type R = Row<'users', { with: { posts: { with: { comments: true } } } }>
    expectTypeOf<R>().toMatchTypeOf<
      FixtureDB['users'] & {
        posts: Array<FixtureDB['posts'] & { comments: FixtureDB['comments'][] }>
      }
    >()
  })

  it('T-2-many-one — users.findMany({ with: { posts: { with: { author: true } } } })', () => {
    type R = Row<'users', { with: { posts: { with: { author: true } } } }>
    expectTypeOf<R>().toMatchTypeOf<
      FixtureDB['users'] & {
        posts: Array<FixtureDB['posts'] & { author: FixtureDB['users'] | null }>
      }
    >()
  })

  it('T-2-one-many — comments.findMany({ with: { post: { with: { comments: true } } } })', () => {
    type R = Row<'comments', { with: { post: { with: { comments: true } } } }>
    expectTypeOf<R>().toMatchTypeOf<
      FixtureDB['comments'] & {
        post: (FixtureDB['posts'] & { comments: FixtureDB['comments'][] }) | null
      }
    >()
  })

  it('T-bool-shorthand — boolean form resolves identically to `{ with: { ... } }` with no nested options', () => {
    type Bool = Row<'users', { with: { posts: true } }>
    type Obj = Row<'users', { with: { posts: {} } }>
    expectTypeOf<Bool>().toMatchTypeOf<Obj>()
    expectTypeOf<Obj>().toMatchTypeOf<Bool>()
  })

  it('T-nested-opts — nested `where`/`limit` does not change the row shape', () => {
    type Plain = Row<'users', { with: { posts: true } }>
    type Filtered = Row<
      'users',
      {
        with: {
          posts: {
            where: (p: FixtureDB['posts']) => never
            limit: 5
          }
        }
      }
    >
    // Both produce `users & { posts: posts[] }` — `where` / `limit`
    // are runtime concerns, the row shape is identical.
    expectTypeOf<Filtered>().toMatchTypeOf<Plain>()
  })

  it('T-self-ref — categories.findMany({ with: { children: { with: { children: true } } } })', () => {
    type R = Row<'categories', { with: { children: { with: { children: true } } } }>
    expectTypeOf<R>().toMatchTypeOf<
      FixtureDB['categories'] & {
        children: Array<
          FixtureDB['categories'] & {
            children: FixtureDB['categories'][]
          }
        >
      }
    >()
  })

  it('T-cycle — users → posts → users round trip via `author`', () => {
    type R = Row<'users', { with: { posts: { with: { author: true } } } }>
    // Each level gets its own slot — the cycle terminates because the
    // adopter only nests as deep as they spell out.
    expectTypeOf<R>().toMatchTypeOf<
      FixtureDB['users'] & {
        posts: Array<FixtureDB['posts'] & { author: FixtureDB['users'] | null }>
      }
    >()
  })

  it('T-bare — findMany without `with` returns the bare table row', () => {
    type R = Row<'users', {}>
    expectTypeOf<R>().toMatchTypeOf<FixtureDB['users']>()
  })

  it('T-null-when-no-relations — categories without augmentation would fall back to `{}`', () => {
    // Sanity check: `with: {}` is a no-op intersect with the empty
    // record, so the row equals the bare table type.
    type R = Row<'categories', { with: {} }>
    expectTypeOf<R>().toMatchTypeOf<FixtureDB['categories']>()
  })
})

describe('FindManyOptions — compile-time guards', () => {
  it('T-bad-key — unknown `with` key is rejected', () => {
    // @ts-expect-error — `posts` has no relation called `nonsense`.
    const _bad: FindManyOptions<'posts'> = { with: { nonsense: true } }
    void _bad
  })

  it('T-known-key — declared `with` keys compile fine', () => {
    const _good: FindManyOptions<'posts'> = {
      with: { author: true, comments: { limit: 10 } },
    }
    void _good
  })

  it('T-bad-target — relation pointing at unknown table is structurally ruled out', () => {
    // Adopters can't construct a relation slot whose `target` is not a
    // `keyof RegisteredDB`; the registry shape forbids it. This case
    // doubles as a compile-time canary for the registry constraint.
    type _CanaryEntry = import('../../src/query/types').RelationMapEntry
    type _TargetField = _CanaryEntry['target']
    expectTypeOf<_TargetField>().toEqualTypeOf<keyof FixtureDB & string>()
  })
})
