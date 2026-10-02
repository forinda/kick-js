/**
 * `@forinda/kickjs-db/testing` on SQLite: createTestDb and rolledBack.
 */
import { describe, expect, it } from 'vitest'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { generate, integer, serial, table, text } from '@forinda/kickjs-db'
import { createTestDb, rolledBack } from '@forinda/kickjs-db/testing'
import { fileURLToPath } from 'node:url'

const users = table('users', { id: serial().primaryKey(), email: text().notNull().unique() })
const posts = table('posts', {
  id: serial().primaryKey(),
  authorId: integer()
    .notNull()
    .references(() => users.id),
})
const schema = { users, posts }

describe('createTestDb', () => {
  it('builds the schema in memory, with foreign keys enforced', async () => {
    const db = await createTestDb({ schema })
    await db.insertInto('users').values({ email: 'a@x.com' }).execute()
    expect(await db.selectFrom('users').select('email').execute()).toEqual([{ email: 'a@x.com' }])
    await expect(db.insertInto('posts').values({ authorId: 99 }).execute()).rejects.toThrow(
      /foreign key/i,
    )
  })

  it('gives each call its own database', async () => {
    const a = await createTestDb({ schema })
    const b = await createTestDb({ schema })
    await a.insertInto('users').values({ email: 'a@x.com' }).execute()
    expect(await b.selectFrom('users').selectAll().execute()).toEqual([])
  })

  it('applies real migrations when given migrationsDir', async () => {
    const here = path.dirname(fileURLToPath(import.meta.url))
    const dir = await mkdtemp(path.join(tmpdir(), 'kickdb-testdb-'))
    const config = {
      schemaPath: path.resolve(here, '../fixtures/schema.demo.ts'),
      migrationsDir: dir,
      dialect: 'sqlite' as const,
    }
    const gen = await generate({ name: 'init', config, cwd: process.cwd() })
    // Unreviewed migrations apply here — tests aren't deploys.
    expect(gen.status).toBe('created')
    const db = await createTestDb({ schema, migrationsDir: dir })
    const tables = await db
      .selectFrom('kick_migrations' as never)
      .selectAll()
      .execute()
    expect(tables).toHaveLength(1)
  })
})

// The annotation the testing guide shows: a typed client declared up front.
let typed: Awaited<ReturnType<typeof createTestDb<typeof schema>>>

describe('rolledBack', () => {
  it('accepts a client typed by its schema', async () => {
    typed = await createTestDb({ schema })
    const emails = await rolledBack(typed, async () => {
      await typed.insertInto('users').values({ email: 't@x.com' }).execute()
      return (await typed.selectFrom('users').select('email').execute()).map((r) => r.email)
    })
    expect(emails).toEqual(['t@x.com'])
  })

  it('rolls back what the test wrote — including code that only holds the client', async () => {
    const db = await createTestDb({ schema })
    const service = {
      create: (email: string) => db.insertInto('users').values({ email }).execute(),
    }

    const result = await rolledBack(db, async () => {
      await service.create('temp@x.com')
      expect(await db.selectFrom('users').selectAll().execute()).toHaveLength(1)
      return 'done'
    })
    expect(result).toBe('done')
    expect(await db.selectFrom('users').selectAll().execute()).toEqual([])
  })

  it('still fails the test on a real error', async () => {
    const db = await createTestDb({ schema })
    await expect(
      rolledBack(db, async () => {
        expect(1).toBe(2)
      }),
    ).rejects.toThrow()
  })
})
