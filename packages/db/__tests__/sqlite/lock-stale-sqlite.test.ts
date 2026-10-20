/** The SQLite lock: taken over only when stale, and only when asked to. */
import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { sqliteAdapter } from '@forinda/kickjs-db/sqlite'

describe('sqliteAdapter lock', () => {
  it('takes over a stale lock only with staleAfterSeconds', async () => {
    const database = new Database(':memory:')
    const adapter = sqliteAdapter({ database })
    await adapter.ensureMigrationTables()
    expect(await adapter.acquireLock('dead')).toBe(true)
    database.exec(`UPDATE kick_migrations_lock SET locked_at = datetime('now', '-2 hours')`)

    expect(await adapter.acquireLock('me')).toBe(false)
    expect(await adapter.acquireLock('me', 7200 + 60)).toBe(false)
    expect(await adapter.acquireLock('me', 60)).toBe(true)
    expect(await adapter.acquireLock('other', 60)).toBe(false)

    database.exec(`UPDATE kick_migrations_lock SET locked_at = datetime('now', '-2 hours')`)
    await adapter.refreshLock!('me')
    expect(await adapter.acquireLock('other', 60)).toBe(false)
  })
})
