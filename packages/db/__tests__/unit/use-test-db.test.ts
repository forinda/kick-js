/** useTestDb: one line per test file — the database is made before the tests and dropped after. */
import { describe, expect, it } from 'vitest'
import { serial, table, text } from '@forinda/kickjs-db'
import { useTestDb } from '@forinda/kickjs-db/testing/vitest'

const users = table('users', { id: serial().primaryKey(), email: text().notNull() })
const t = useTestDb({ schema: { users }, dialect: 'sqlite' })

let early: unknown
try {
  early = t.db
} catch (err) {
  early = err
}

describe('useTestDb', () => {
  it("isn't there before the tests run", () => {
    expect(String(early)).toMatch(/useTestDb: the database exists inside tests/)
  })

  it('has the schema inside a test', async () => {
    await t.db.insertInto('users').values({ email: 'a@x.com' }).execute()
    expect(await t.db.selectFrom('users').select('email').execute()).toEqual([{ email: 'a@x.com' }])
  })

  it("defaults to SQLite when there's no server", () => {
    expect(t.connectionString).toBeUndefined()
  })
})
