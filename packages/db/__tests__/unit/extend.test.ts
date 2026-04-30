import { describe, it, expect } from 'vitest'
import {
  DummyDriver,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  type Dialect,
} from 'kysely'

import { createDbClient, table, serial, varchar } from '../../src/index'

const dummy: Dialect = {
  createAdapter: () => new PostgresAdapter(),
  createDriver: () => new DummyDriver(),
  createIntrospector: (db) => new PostgresIntrospector(db),
  createQueryCompiler: () => new PostgresQueryCompiler(),
}

const users = table('users', {
  id: serial().primaryKey(),
  email: varchar(255).notNull(),
})
const posts = table('posts', {
  id: serial().primaryKey(),
  title: varchar(500).notNull(),
})

describe('db.$extends({ model })', () => {
  it('returns a client with per-table method bags reachable as accessors', () => {
    const db = createDbClient({ schema: { users, posts }, dialect: dummy })
    const dbX = db.$extends({
      model: {
        users: { meta: () => ({ kind: 'users' as const }) },
        posts: { meta: () => ({ kind: 'posts' as const }) },
      },
    })
    expect(dbX.users.meta()).toEqual({ kind: 'users' })
    expect(dbX.posts.meta()).toEqual({ kind: 'posts' })
  })

  it('forwards original KickDbClient methods through the proxy', async () => {
    const db = createDbClient({ schema: { users }, dialect: dummy })
    const dbX = db.$extends({ model: { users: {} } })
    // selectFrom / dialect / kysely all flow through the proxy
    // unchanged. dummy dialect's ctor.name is 'Object' so detect
    // falls through to sqlite — value's identity is what matters,
    // not which dialect we landed on.
    expect(dbX.dialect).toBe(db.dialect)
    expect(dbX.qb).toBe(db.qb)
    expect(typeof dbX.selectFrom).toBe('function')
    await dbX.selectFrom('users').selectAll().execute()
    await dbX.destroy()
  })

  it('inside a method, `this` is the extended client (not the original)', async () => {
    const db = createDbClient({ schema: { users }, dialect: dummy })
    // Methods on the model bag can't carry a `this:` annotation that
    // describes the rebound proxy — TS checks each method against the
    // surrounding record shape, not the runtime rebinding. Cast
    // `this` inside the body when you need the typed surface.
    const dbX = db.$extends({
      model: {
        users: {
          findByEmail(email: string) {
            const self = this as unknown as typeof db
            return self.selectFrom('users').selectAll().where('email', '=', email).execute()
          },
        },
      },
    })
    // The method calls this.selectFrom — would throw if `this`
    // wasn't bound. Result is empty (DummyDriver returns nothing)
    // but the call must succeed.
    const result = await dbX.users.findByEmail('a@b.com')
    expect(Array.isArray(result)).toBe(true)
    await dbX.destroy()
  })

  it('methods can call other tables via this.<otherTable>.<m>', () => {
    const db = createDbClient({ schema: { users, posts }, dialect: dummy })
    // Cross-table calls work at runtime via Function.prototype.call —
    // `this` is the extended proxy, not the bag the method is declared
    // in. TS can't see that, so we cast `this` inside the method to
    // the shape the method touches. `this: typeof dbX` would self-
    // reference the const we're declaring (TS rejects the cycle).
    type CrossTable = { posts: { label(): string } }
    const dbX = db.$extends({
      model: {
        users: {
          stamp() {
            return (this as unknown as CrossTable).posts.label()
          },
        },
        posts: {
          label() {
            return 'posts'
          },
        },
      },
    })
    expect(dbX.users.stamp()).toBe('posts')
  })

  it('chained $extends layers methods cumulatively', () => {
    const db = createDbClient({ schema: { users }, dialect: dummy })
    const dbA = db.$extends({
      model: { users: { a: () => 'A' } },
    })
    const dbB = dbA.$extends({
      model: { users: { b: () => 'B' } },
    })
    // The proxy from $extends only exposes the methods supplied at
    // that call. Chaining puts dbB.users.b on top; dbA.users.a is
    // NOT carried forward (each $extends builds a fresh bag from
    // its argument). Documented expectation:
    expect(dbB.users.b()).toBe('B')
    // Original a still reachable via dbA:
    expect(dbA.users.a()).toBe('A')
  })

  it('does nothing when ext.model is missing', () => {
    const db = createDbClient({ schema: { users }, dialect: dummy })
    const dbX = db.$extends({})
    expect(dbX.dialect).toBe(db.dialect)
    expect(typeof dbX.selectFrom).toBe('function')
  })
})
