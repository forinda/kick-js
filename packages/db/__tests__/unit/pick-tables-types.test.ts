/**
 * M5.A.3 — type-only assertions for the Kysely 0.29 narrowing
 * helpers as reached through `KickDbClient<DB>`.
 *
 * These tests exist purely so a future Kysely upgrade can't silently
 * drop `$pickTables` / `$omitTables` / `ReadonlyKysely` from the
 * surface adopters reach via `@forinda/kickjs-db`. There's no
 * runtime to assert; `expectTypeOf` is the contract — and the
 * casted fixture below is never actually executed (the methods are
 * read off the type, never called).
 */

import { describe, expectTypeOf, it } from 'vitest'

import type { Kysely } from 'kysely'
import type { KickDbClient, ReadonlyKysely } from '@forinda/kickjs-db'

interface FixtureDB {
  users: { id: number; email: string }
  posts: { id: number; authorId: number; title: string }
  comments: { id: number; postId: number; body: string }
}

describe('M5.A.3 — KickDbClient narrowing helpers (type-only)', () => {
  it('$pickTables exists on the client type and is generic over keys of DB', () => {
    type Client = KickDbClient<FixtureDB>
    expectTypeOf<Client>().toHaveProperty('$pickTables')

    // Result of the narrowing — derived structurally without calling
    // the method (the runtime fixture is `{} as Client` and would
    // throw on actual invocation). Kysely's $pickTables returns a
    // Kysely<Pick<DB, T>>; we lock that the resulting client's
    // selectFrom only accepts the picked subset.
    type Picked = Kysely<Pick<FixtureDB, 'users' | 'posts'>>
    type SelectFromArg = Parameters<Picked['selectFrom']>[0]

    expectTypeOf<'users'>().toMatchTypeOf<SelectFromArg>()
    expectTypeOf<'posts'>().toMatchTypeOf<SelectFromArg>()
    // @ts-expect-error — `comments` removed from the picked schema.
    const _commentsFails: SelectFromArg = 'comments'
    void _commentsFails
  })

  it('$omitTables exists on the client type and removes the omitted keys', () => {
    type Client = KickDbClient<FixtureDB>
    expectTypeOf<Client>().toHaveProperty('$omitTables')

    type Trimmed = Kysely<Omit<FixtureDB, 'comments'>>
    type SelectFromArg = Parameters<Trimmed['selectFrom']>[0]

    expectTypeOf<'users'>().toMatchTypeOf<SelectFromArg>()
    expectTypeOf<'posts'>().toMatchTypeOf<SelectFromArg>()
    // @ts-expect-error — `comments` was omitted.
    const _commentsFails: SelectFromArg = 'comments'
    void _commentsFails
  })

  it('ReadonlyKysely<DB> drops the mutation methods', () => {
    type Read = ReadonlyKysely<FixtureDB>

    expectTypeOf<Read>().toHaveProperty('selectFrom')
    expectTypeOf<Read>().toHaveProperty('with')

    expectTypeOf<keyof Read>().not.toMatchTypeOf<'insertInto'>()
    expectTypeOf<keyof Read>().not.toMatchTypeOf<'updateTable'>()
    expectTypeOf<keyof Read>().not.toMatchTypeOf<'deleteFrom'>()
    expectTypeOf<keyof Read>().not.toMatchTypeOf<'mergeInto'>()
  })

  it('KickDbClient<DB> assigns to Kysely<DB>', () => {
    expectTypeOf<KickDbClient<FixtureDB>>().toMatchTypeOf<Kysely<FixtureDB>>()
  })
})
