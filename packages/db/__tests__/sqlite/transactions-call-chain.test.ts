/**
 * Transactions that follow the call chain (D.6) and transaction retry (D.7),
 * against a real SQLite database.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'
import {
  SerializationFailureError,
  TransactionFinishedError,
  UniqueViolationError,
  createDbClient,
  serial,
  table,
  varchar,
  type KickDbClient,
} from '@forinda/kickjs-db'
import { sqliteDialect } from '@forinda/kickjs-db/sqlite'

const users = table('users', { id: serial().primaryKey(), email: varchar(255).notNull().unique() })
const schema = { users }
interface DB {
  users: { id: number; email: string }
}

let database: Database.Database
let db: KickDbClient<DB>

/** A repository holding the plain client — the way services get it from DI. */
const repo = {
  add: (email: string) => db.insertInto('users').values({ email }).execute(),
}
const emails = async () =>
  (await db.selectFrom('users').select('email').orderBy('id').execute()).map((r) => r.email)

beforeAll(() => {
  database = new Database(':memory:')
  database.exec(
    'CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL UNIQUE)',
  )
  db = createDbClient<typeof schema, DB>({
    schema,
    dialect: sqliteDialect({ database }),
    events: true,
  })
})
beforeEach(() => {
  database.exec('DELETE FROM users')
})
afterAll(async () => {
  await db?.destroy()
})

describe('transactions follow the call chain', () => {
  it('code using the plain client joins the transaction — and rolls back with it', async () => {
    await expect(
      db.transaction(async () => {
        await repo.add('a@x.io')
        expect(db.inTransaction).toBe(true)
        throw new Error('abort')
      }),
    ).rejects.toThrow('abort')
    expect(await emails()).toEqual([])
    expect(db.inTransaction).toBe(false)
  })

  it('a nested transaction() reuses the outer one by default', async () => {
    await expect(
      db.transaction(async () => {
        await repo.add('outer@x.io')
        await db.transaction(async (tx) => {
          await tx.insertInto('users').values({ email: 'inner@x.io' }).execute()
        })
        throw new Error('outer fails')
      }),
    ).rejects.toThrow('outer fails')
    expect(await emails()).toEqual([])
  })

  it("nested: 'savepoint' undoes only the inner part", async () => {
    await db.transaction(async () => {
      await repo.add('kept@x.io')
      await db
        .transaction({ nested: 'savepoint' }, async () => {
          await repo.add('undone@x.io')
          await repo.add('kept@x.io') // unique violation
        })
        .catch((e) => expect(e).toBeInstanceOf(UniqueViolationError))
    })
    expect(await emails()).toEqual(['kept@x.io'])
  })

  it("nested: 'separate' is refused on SQLite's single connection", async () => {
    await db.transaction(async () => {
      await expect(db.transaction({ nested: 'separate' }, async () => {})).rejects.toThrow(
        /needs a second connection/,
      )
    })
  })

  it('$extends clients route into the transaction too', async () => {
    const ext = db.$extends({
      result: {
        users: {
          upper: {
            needs: { email: true },
            compute: (u: { email: string }) => u.email.toUpperCase(),
          },
        },
      },
    } as never) as unknown as KickDbClient<DB>
    await expect(
      db.transaction(async () => {
        await ext.insertInto('users').values({ email: 'ext@x.io' }).execute()
        throw new Error('abort')
      }),
    ).rejects.toThrow('abort')
    expect(await emails()).toEqual([])
  })
})

describe('afterCommit', () => {
  it('runs after commit, in order; dropped on rollback', async () => {
    const seen: string[] = []
    await db.transaction(async () => {
      await db.afterCommit(() => void seen.push('one'))
      await repo.add('a@x.io')
      await db.afterCommit(() => void seen.push('two'))
      expect(seen).toEqual([])
    })
    expect(seen).toEqual(['one', 'two'])

    await db
      .transaction(async () => {
        await db.afterCommit(() => void seen.push('never'))
        throw new Error('rollback')
      })
      .catch(() => {})
    expect(seen).toEqual(['one', 'two'])
  })

  it('a hook behind a rolled-back savepoint is dropped; outside a transaction it runs now', async () => {
    const seen: string[] = []
    await db.transaction(async () => {
      await db
        .transaction({ nested: 'savepoint' }, async () => {
          await db.afterCommit(() => void seen.push('inner'))
          throw new Error('undo inner')
        })
        .catch(() => {})
      await db.afterCommit(() => void seen.push('outer'))
    })
    expect(seen).toEqual(['outer'])
    await db.afterCommit(() => void seen.push('now'))
    expect(seen).toEqual(['outer', 'now'])
  })

  it('a failing hook leaves the transaction committed', async () => {
    await db.transaction(async () => {
      await repo.add('committed@x.io')
      await db.afterCommit(() => {
        throw new Error('mail server down')
      })
    })
    expect(await emails()).toEqual(['committed@x.io'])
  })
})

describe('retry', () => {
  const conflict = () =>
    new SerializationFailureError({ dialect: 'sqlite', columns: [] }, new Error('busy'))

  it('runs the transaction again on a retryable failure, with backoff events', async () => {
    const retries = vi.fn()
    db.on('transactionRetry', retries)
    let calls = 0
    const result = await db.transaction({ retry: { attempts: 3, baseDelayMs: 1 } }, async () => {
      calls++
      await repo.add(`try${calls}@x.io`)
      if (calls < 3) throw conflict()
      return 'done'
    })
    db.off('transactionRetry', retries)
    expect(result).toBe('done')
    expect(calls).toBe(3)
    expect(await emails()).toEqual(['try3@x.io']) // failed attempts rolled back
    expect(retries.mock.calls.map(([e]) => e.attempt)).toEqual([2, 3])
  })

  it('gives up after the last attempt, and never retries other errors', async () => {
    let calls = 0
    await expect(
      db.transaction({ retry: { attempts: 2, baseDelayMs: 1 } }, async () => {
        calls++
        throw conflict()
      }),
    ).rejects.toBeInstanceOf(SerializationFailureError)
    expect(calls).toBe(2)

    calls = 0
    await expect(
      db.transaction({ retry: true }, async () => {
        calls++
        throw new Error('bug')
      }),
    ).rejects.toThrow('bug')
    expect(calls).toBe(1)
  })
})

describe('work that outlives its transaction', () => {
  it('no longer counts as in the transaction, and a late query says why it failed', async () => {
    let late!: Promise<{ inTx: boolean; error: unknown }>
    const ranHook: string[] = []
    await db.transaction(async () => {
      // Not awaited — runs on after the transaction commits.
      late = (async () => {
        await new Promise((r) => setTimeout(r, 10))
        const inTx = db.inTransaction
        await db.afterCommit(() => void ranHook.push('late hook'))
        const error = await (async () => repo.add('late@x.io'))().catch((e) => e)
        return { inTx, error }
      })()
    })
    const { inTx, error } = await late
    expect(inTx).toBe(false)
    expect(error).toBeInstanceOf(TransactionFinishedError)
    expect(ranHook).toEqual(['late hook']) // outside a transaction it runs at once
    expect(await emails()).toEqual([])
  })
})
