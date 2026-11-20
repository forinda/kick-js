/** createMysqlTestDb: per-file databases on a shared MySQL, from a template migrated once. */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { MySqlContainer, type StartedMySqlContainer } from '@testcontainers/mysql'
import { createConnection } from 'mysql2/promise'
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

const { createMysqlTestDb } = await import('@forinda/kickjs-db/testing')

const here = path.dirname(fileURLToPath(import.meta.url))
let container: StartedMySqlContainer
let server: string
let dir: string
let migrationsDir: string

beforeAll(async () => {
  container = await new MySqlContainer('mysql:8.4').start()
  server = container.getConnectionUri(true)
  dir = await mkdtemp(path.join(here, '../fixtures/tmp-test-db-mysql-'))
  const schemaPath = path.join(dir, 'schema.ts')
  await writeFile(
    schemaPath,
    [
      "import { integer, serial, table, text } from '@forinda/kickjs-db'",
      "export const users = table('users', { id: serial().primaryKey(), email: text().notNull() })",
      "export const posts = table('posts', { id: serial().primaryKey(), authorId: integer().notNull().references(() => users.id) })",
    ].join('\n'),
  )
  migrationsDir = path.join(dir, 'migrations')
  await generate({
    name: 'init',
    config: { schemaPath, migrationsDir, dialect: 'mysql' },
    cwd: dir,
  })
}, 180_000)

afterAll(async () => {
  await container?.stop()
  if (dir) await rm(dir, { recursive: true, force: true })
}, 60_000)

async function query<T>(sql: string, args: unknown[] = []): Promise<T[]> {
  const c = await createConnection({ uri: server })
  try {
    const [rows] = await c.query(sql, args)
    return rows as T[]
  } finally {
    await c.end()
  }
}
const schemaOf = (url: string) => decodeURIComponent(new URL(url).pathname.slice(1))
const tablesIn = async (db: string) =>
  (
    await query<{ t: string }>(
      'select table_name as t from information_schema.tables where table_schema = ? order by 1',
      [db],
    )
  ).map((r) => r.t)

describe('createMysqlTestDb', () => {
  it('copies a template migrated once, foreign keys and migration history included', async () => {
    runs.migrate = 0
    const a = await createMysqlTestDb({ migrationsDir, connectionString: server })
    const b = await createMysqlTestDb({ migrationsDir, connectionString: server })
    expect(runs.migrate).toBe(1)
    for (const t of [a, b]) {
      expect(await tablesIn(schemaOf(t.connectionString))).toEqual(
        expect.arrayContaining(['kick_migrations', 'posts', 'users']),
      )
      const [m] = await query<{ n: number }>(
        `select count(*) as n from \`${schemaOf(t.connectionString)}\`.kick_migrations`,
      )
      expect(Number(m!.n)).toBe(1)
    }
    await expect(
      query(`insert into \`${schemaOf(a.connectionString)}\`.posts (\`authorId\`) values (999)`),
    ).rejects.toThrow(/foreign key/i)
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
    expect(
      await query(`select schema_name from information_schema.schemata where schema_name = ?`, [
        schemaOf(a.connectionString),
      ]),
    ).toEqual([])
  })

  it('makes an empty database, refuses a non-test server, and reads KICK_TEST_MYSQL_URL', async () => {
    const e = await createMysqlTestDb({ connectionString: server })
    expect(await tablesIn(schemaOf(e.connectionString))).toEqual([])
    await e.drop()
    const url = new URL(server)
    url.pathname = '/app'
    await expect(createMysqlTestDb({ connectionString: url.toString() })).rejects.toThrow(
      /"app".*test/,
    )
    vi.stubEnv('KICK_TEST_MYSQL_URL', server)
    const f = await createMysqlTestDb({})
    vi.unstubAllEnvs()
    await f.drop()
  })

  it('sweeps old leftovers on the first create, skipping one in use', async () => {
    await query('create database if not exists kicktest_meta')
    await query(
      'create table if not exists kicktest_meta.dbs (name varchar(64) primary key, created_at bigint not null)',
    )
    for (const n of ['kick_test_old', 'kick_test_busy', 'kick_test_recent'])
      await query(`create database ${n}`)
    await query('insert into kicktest_meta.dbs values (?, 0), (?, 0), (?, ?)', [
      'kick_test_old',
      'kick_test_busy',
      'kick_test_recent',
      Date.now(),
    ])
    const busy = new URL(server)
    busy.pathname = '/kick_test_busy'
    const holder = await createConnection({ uri: busy.toString() })

    vi.resetModules()
    const fresh = await import('@forinda/kickjs-db/testing')
    const e = await fresh.createMysqlTestDb({ connectionString: server })
    const left = (
      await query<{ s: string }>(
        "select schema_name as s from information_schema.schemata where schema_name like 'kick\\\\_test\\\\_%'",
      )
    ).map((r) => r.s)
    expect(left).not.toContain('kick_test_old')
    expect(left).toContain('kick_test_busy')
    expect(left).toContain('kick_test_recent')
    await holder.end()
    await e.drop()
  })
})
