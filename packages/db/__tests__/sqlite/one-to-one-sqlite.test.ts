/**
 * One-to-one from both sides: the side with the key names it as `fields`;
 * the other side names its own key as `fields` and the child's as
 * `references`. A missing child reads as `null`.
 */
import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import {
  createDbClient,
  diff,
  emitSqlite,
  extractSnapshot,
  integer,
  relations,
  serial,
  table,
  text,
} from '@forinda/kickjs-db'
import { sqliteDialect } from '@forinda/kickjs-db/sqlite'

const users = table('users', { id: serial().primaryKey(), name: text().notNull() })
const profiles = table('profiles', {
  id: serial().primaryKey(),
  userId: integer()
    .notNull()
    .unique()
    .references(() => users.id),
  bio: text(),
})
const userRelations = relations(users, ({ one }) => ({
  profile: one(profiles, { fields: [users.id], references: [profiles.userId] }),
}))
const profileRelations = relations(profiles, ({ one }) => ({
  user: one(users, { fields: [profiles.userId], references: [users.id] }),
}))
const schema = { users, profiles, userRelations, profileRelations }

function make() {
  const database = new Database(':memory:')
  const empty = { version: 1 as const, dialect: 'sqlite' as const, tables: {} }
  const target = extractSnapshot(schema, 'sqlite')
  database.exec(emitSqlite(diff(empty, target), { from: empty, to: target }))
  return createDbClient({ schema, dialect: sqliteDialect({ database }) })
}

describe('one-to-one on SQLite', () => {
  it('reads from the side without the key, null when there is no child', async () => {
    const db = make()
    await db
      .insertInto('users')
      .values([{ name: 'a' }, { name: 'b' }])
      .execute()
    await db.insertInto('profiles').values({ userId: 1, bio: 'hi' }).execute()
    const rows = await db.query.users.findMany({ with: { profile: true } })
    expect(rows.map((u) => u.profile?.bio ?? null)).toEqual(['hi', null])
  })

  it('reads from the side with the key', async () => {
    const db = make()
    await db.insertInto('users').values({ name: 'a' }).execute()
    await db.insertInto('profiles').values({ userId: 1, bio: 'hi' }).execute()
    const rows = await db.query.profiles.findMany({ with: { user: true } })
    expect(rows[0]!.user?.name).toBe('a')
  })
})
