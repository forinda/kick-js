/**
 * Typed errors from a real SQLite database through createDbClient — inside
 * and outside a transaction.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import {
  CheckViolationError,
  ForeignKeyViolationError,
  NotNullViolationError,
  UniqueViolationError,
  createDbClient,
  integer,
  serial,
  table,
  varchar,
  type KickDbClient,
} from '@forinda/kickjs-db'
import { sqliteDialect } from '@forinda/kickjs-db/sqlite'

const users = table('users', {
  id: serial().primaryKey(),
  email: varchar(255).notNull().unique(),
})
const posts = table('posts', {
  id: serial().primaryKey(),
  userId: integer().notNull(),
  price: integer().notNull(),
})
const schema = { users, posts }

interface DB {
  users: { id: number; email: string }
  posts: { id: number; userId: number; price: number }
}

let database: Database.Database
let db: KickDbClient<DB>

beforeAll(() => {
  database = new Database(':memory:')
  database.pragma('foreign_keys = ON')
  database.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL UNIQUE);
    CREATE TABLE posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      userId INTEGER NOT NULL REFERENCES users(id),
      price INTEGER NOT NULL CONSTRAINT price_positive CHECK (price > 0)
    );
  `)
  db = createDbClient<typeof schema, DB>({ schema, dialect: sqliteDialect({ database }) })
})

afterAll(async () => {
  await db?.destroy()
})

describe('typed errors (sqlite)', () => {
  it('unique violation names the table and column', async () => {
    await db.insertInto('users').values({ email: 'a@b.c' }).execute()
    const err = await db
      .insertInto('users')
      .values({ email: 'a@b.c' })
      .execute()
      .catch((e) => e)
    expect(err).toBeInstanceOf(UniqueViolationError)
    expect(err).toMatchObject({ table: 'users', columns: ['email'], status: 409 })
  })

  it('foreign key, check and not-null', async () => {
    await expect(
      db.insertInto('posts').values({ userId: 999, price: 1 }).execute(),
    ).rejects.toBeInstanceOf(ForeignKeyViolationError)
    const check = await db
      .insertInto('posts')
      .values({ userId: 1, price: -1 })
      .execute()
      .catch((e) => e)
    expect(check).toBeInstanceOf(CheckViolationError)
    expect(check.constraint).toBe('price_positive')
    await expect(
      db
        .insertInto('users')
        .values({ email: null as unknown as string })
        .execute(),
    ).rejects.toBeInstanceOf(NotNullViolationError)
  })

  it('inside a transaction, and the transaction rolls back', async () => {
    const err = await db
      .transaction(async (tx) => {
        await tx.insertInto('users').values({ email: 'in-tx@b.c' }).execute()
        await tx.insertInto('users').values({ email: 'a@b.c' }).execute()
      })
      .catch((e) => e)
    expect(err).toBeInstanceOf(UniqueViolationError)
    const rows = await db
      .selectFrom('users')
      .select('email')
      .where('email', '=', 'in-tx@b.c')
      .execute()
    expect(rows).toEqual([])
  })
})
