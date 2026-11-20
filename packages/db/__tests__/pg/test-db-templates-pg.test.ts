/**
 * createPgTestDb on a shared server: migrations run once into a template and
 * are copied per file; an empty mode; the `test` guard; a sweep of leftovers.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm, writeFile, appendFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import pg from 'pg'
import { generate } from '@forinda/kickjs-db'

const runs = vi.hoisted(() => ({ migrate: 0 }))
vi.mock('../../src/migrate/runner', async (orig) => {
  const real = await orig<typeof import('../../src/migrate/runner')>()
  return {
    ...real,
    migrateLatest: (async (...a: Parameters<typeof real.migrateLatest>) => {
      runs.migrate++
      return real.migrateLatest(...a)
    }) as typeof real.migrateLatest,
  }
})

const { createPgTestDb, templateKey } = await import('@forinda/kickjs-db/testing')
const { useTestDb } = await import('@forinda/kickjs-db/testing/vitest')
const { serial, table, text } = await import('@forinda/kickjs-db')

const here = path.dirname(fileURLToPath(import.meta.url))
let container: StartedPostgreSqlContainer
let server: string
let dir: string
let migrationsDir: string

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:17-alpine').start()
  server = container.getConnectionUri()
  // As kickTestServices sets it: useTestDb below reads it.
  process.env.KICK_TEST_POSTGRES_URL = server
  dir = await mkdtemp(path.join(here, '../fixtures/tmp-test-db-tpl-'))
  const schemaPath = path.join(dir, 'schema.ts')
  await writeFile(
    schemaPath,
    `import { serial, table, text } from '@forinda/kickjs-db'\nexport const users = table('users', { id: serial().primaryKey(), email: text().notNull() })`,
  )
  migrationsDir = path.join(dir, 'migrations')
  await generate({
    name: 'init',
    config: { schemaPath, migrationsDir, dialect: 'postgres' },
    cwd: dir,
  })
}, 120_000)

afterAll(async () => {
  await container?.stop()
  if (dir) await rm(dir, { recursive: true, force: true })
}, 60_000)

async function names(like: string) {
  const c = new pg.Client({ connectionString: server })
  await c.connect()
  const { rows } = await c.query<{ datname: string }>(
    'select datname from pg_database where datname like $1',
    [like],
  )
  await c.end()
  return rows.map((r) => r.datname).toSorted()
}
const tables = async (url: string) => {
  const c = new pg.Client({ connectionString: url })
  await c.connect()
  const { rows } = await c.query<{ t: string }>(
    "select tablename as t from pg_tables where schemaname = 'public' order by 1",
  )
  await c.end()
  return rows.map((r) => r.t)
}

describe('createPgTestDb — templates', () => {
  it('migrates once into a template, and copies it for every file', async () => {
    runs.migrate = 0
    const a = await createPgTestDb({ migrationsDir, connectionString: server })
    const b = await createPgTestDb({ migrationsDir, connectionString: server })
    expect(runs.migrate).toBe(1)
    const key = await templateKey({ migrationsDir })
    expect(await names('kick_tpl_%')).toEqual([`kick_tpl_${key}`])
    for (const t of [a, b]) {
      expect(await tables(t.connectionString)).toEqual(
        expect.arrayContaining(['kick_migrations', 'users']),
      )
    }
    await a.db
      .insertInto('users' as never)
      .values({ email: 'a' } as never)
      .execute()
    expect(
      await b.db
        .selectFrom('users' as never)
        .selectAll()
        .execute(),
    ).toEqual([])
    await Promise.all([a.drop(), b.drop()])
  })

  it('builds a new template once when files race for it', async () => {
    const fresh = await mkdtemp(path.join(here, '../fixtures/tmp-test-db-race-'))
    const copy = path.join(fresh, 'migrations')
    const { cp } = await import('node:fs/promises')
    await cp(migrationsDir, copy, { recursive: true })
    const id = (await readdir(copy)).find((f) => !f.startsWith('_') && !f.endsWith('.json'))!
    await appendFile(path.join(copy, id, 'up.sql'), '\n-- race\n')
    runs.migrate = 0
    const made = await Promise.all(
      [1, 2, 3].map(() => createPgTestDb({ migrationsDir: copy, connectionString: server })),
    )
    expect(runs.migrate).toBe(1)
    expect(await templateKey({ migrationsDir: copy })).not.toBe(
      await templateKey({ migrationsDir }),
    )
    await Promise.all(made.map((m) => m.drop()))
    await rm(fresh, { recursive: true, force: true })
  })

  it('makes an empty database when given no schema or migrations', async () => {
    const before = await names('kick_tpl_%')
    const e = await createPgTestDb({ connectionString: server })
    expect(await tables(e.connectionString)).toEqual([])
    expect(await names('kick_tpl_%')).toEqual(before)
    await e.drop()
  })

  it("refuses a server database whose name doesn't say test", async () => {
    const url = new URL(server)
    url.pathname = '/app'
    await expect(createPgTestDb({ connectionString: url.toString() })).rejects.toThrow(
      /"app".*test/,
    )
    url.pathname = '/postgres'
    const ok = await createPgTestDb({
      connectionString: url.toString(),
      allowNonTestDatabase: true,
    })
    await ok.drop()
  })

  it('reads KICK_TEST_POSTGRES_URL when no connection string is given', async () => {
    vi.stubEnv('KICK_TEST_POSTGRES_URL', server)
    const e = await createPgTestDb({})
    vi.unstubAllEnvs()
    expect(e.connectionString).toContain('kick_test_')
    await e.drop()
  })
})

describe('createPgTestDb — leftovers', () => {
  it('drops old kick_test_ databases on the first create, and skips ones in use', async () => {
    const admin = new pg.Client({ connectionString: server })
    await admin.connect()
    for (const n of ['kick_test_old', 'kick_test_busy', 'kick_test_recent'])
      await admin.query(`create database ${n}`)
    await admin.query(
      `comment on database kick_test_old is 'kick_test created 2000-01-01T00:00:00.000Z'`,
    )
    await admin.query(
      `comment on database kick_test_busy is 'kick_test created 2000-01-01T00:00:00.000Z'`,
    )
    await admin.query(
      `comment on database kick_test_recent is 'kick_test created ${new Date().toISOString()}'`,
    )
    await admin.end()
    const busy = new URL(server)
    busy.pathname = '/kick_test_busy'
    const holder = new pg.Client({ connectionString: busy.toString() })
    await holder.connect()

    vi.resetModules()
    const fresh = await import('@forinda/kickjs-db/testing')
    const e = await fresh.createPgTestDb({ connectionString: server })
    const left = await names('kick_test_%')
    expect(left).not.toContain('kick_test_old')
    expect(left).toContain('kick_test_busy')
    expect(left).toContain('kick_test_recent')
    await holder.end()
    await e.drop()
  })
})

describe('useTestDb on the shared Postgres', () => {
  const t = useTestDb({
    schema: { notes: table('notes', { id: serial().primaryKey(), body: text().notNull() }) },
  })
  it('makes its database on the server KICK_TEST_POSTGRES_URL names', async () => {
    expect(t.connectionString).toMatch(/kick_test_/)
    await t.db.insertInto('notes').values({ body: 'x' }).execute()
    expect(await t.db.selectFrom('notes').select('body').execute()).toEqual([{ body: 'x' }])
  })
})
