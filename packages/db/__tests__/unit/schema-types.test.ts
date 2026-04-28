import { describe, expectTypeOf, it } from 'vitest'
import type { Generated } from 'kysely'
import {
  table,
  serial,
  varchar,
  text,
  boolean,
  integer,
  timestamp,
  uuid,
  jsonb,
  type SchemaToKysely,
} from '@forinda/kickjs-db'

const users = table('users', {
  id: serial().primaryKey(),
  email: varchar(255).notNull().unique(),
  name: varchar(120),
  isActive: boolean().notNull().default('true'),
  createdAt: timestamp().notNull().defaultNow(),
  signupCount: integer(),
  bio: text(),
  metadata: jsonb<{ tags: string[] }>(),
})

// Two posts-shaped tables to verify the chain order doesn't matter — both
// `uuid().primaryKey().defaultRandom()` and `uuid().defaultRandom().primaryKey()`
// must produce `Generated<string>` because the brand intersection preserves
// the subclass identity through chain methods.
const posts = table('posts', {
  id: uuid().primaryKey().defaultRandom(),
  authorId: integer().notNull(),
  body: text().notNull(),
})

const comments = table('comments', {
  id: uuid().defaultRandom().primaryKey(),
  postId: integer().notNull(),
  body: text().notNull(),
})

type DB = SchemaToKysely<{ users: typeof users; posts: typeof posts; comments: typeof comments }>

describe('SchemaToKysely', () => {
  it('serial primary key wraps in Generated<number>', () => {
    expectTypeOf<DB['users']['id']>().toEqualTypeOf<Generated<number>>()
  })

  it('uuid().primaryKey().defaultRandom() works (chain preserves UuidBuilder)', () => {
    expectTypeOf<DB['posts']['id']>().toEqualTypeOf<Generated<string>>()
  })

  it('uuid().defaultRandom().primaryKey() also works (reverse order)', () => {
    expectTypeOf<DB['comments']['id']>().toEqualTypeOf<Generated<string>>()
  })

  it('timestamp with defaultNow wraps in Generated<Date>', () => {
    expectTypeOf<DB['users']['createdAt']>().toEqualTypeOf<Generated<Date>>()
  })

  it('boolean with default wraps in Generated<boolean>', () => {
    expectTypeOf<DB['users']['isActive']>().toEqualTypeOf<Generated<boolean>>()
  })

  it('not-null columns are bare T (no Generated, no null)', () => {
    expectTypeOf<DB['users']['email']>().toEqualTypeOf<string>()
    expectTypeOf<DB['posts']['authorId']>().toEqualTypeOf<number>()
    expectTypeOf<DB['posts']['body']>().toEqualTypeOf<string>()
  })

  it('nullable columns are T | null', () => {
    expectTypeOf<DB['users']['name']>().toEqualTypeOf<string | null>()
    expectTypeOf<DB['users']['signupCount']>().toEqualTypeOf<number | null>()
    expectTypeOf<DB['users']['bio']>().toEqualTypeOf<string | null>()
  })

  it('jsonb<T>() carries the user-declared shape', () => {
    expectTypeOf<DB['users']['metadata']>().toEqualTypeOf<{ tags: string[] } | null>()
  })

  it('table names are inferred as literals (no widening to string)', () => {
    expectTypeOf<keyof DB>().toEqualTypeOf<'users' | 'posts' | 'comments'>()
  })
})
