/**
 * D.23: kick/db on async SQLite drivers — libsql/Turso and Cloudflare D1 (via
 * Miniflare). Migrations through asyncSqliteAdapter, queries through each
 * driver's own Kysely dialect, detected as SQLite without a tag.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@libsql/client'
import { LibsqlDialect } from '@libsql/kysely-libsql'
import { D1Dialect } from 'kysely-d1'
import { Miniflare } from 'miniflare'
import { Kysely, type Dialect } from 'kysely'
import {
  createDbClient,
  generate,
  migrateLatest,
  serial,
  table,
  text,
  integer,
} from '@forinda/kickjs-db'
import {
  asyncSqliteAdapter,
  d1Driver,
  libsqlDriver,
  type AsyncSqliteDriver,
} from '@forinda/kickjs-db/sqlite'

const here = path.dirname(fileURLToPath(import.meta.url))

type Target = { driver: AsyncSqliteDriver; dialect: Dialect; close(): Promise<void> }

const targets: Array<[string, (dir: string) => Promise<Target>]> = [
  [
    'libsql',
    async (dir) => {
      const client = createClient({ url: `file:${path.join(dir, 'app.db')}` })
      return {
        driver: libsqlDriver(client),
        dialect: new LibsqlDialect({ client }),
        close: async () => client.close(),
      }
    },
  ],
  [
    'Cloudflare D1',
    async () => {
      const mf = new Miniflare({
        modules: true,
        script: 'export default { fetch() { return new Response(null) } }',
        d1Databases: ['DB'],
      })
      const database = await mf.getD1Database('DB')
      return {
        driver: d1Driver(database as never),
        dialect: new D1Dialect({ database: database as never }),
        close: () => mf.dispose(),
      }
    },
  ],
]

const schemaV1 = `import { integer, serial, table, text } from '@forinda/kickjs-db'
export const users = table('users', { id: serial().primaryKey(), email: text().notNull().unique() })
export const posts = table('posts', {
  id: serial().primaryKey(),
  userId: integer().notNull().references(() => users.id),
  title: text(),
})`

// title becomes NOT NULL with a default: SQLite can only do that by rebuilding the table.
const schemaV2 = schemaV1.replace('title: text(),', "title: text().notNull().default('untitled'),")

const users = table('users', { id: serial().primaryKey(), email: text().notNull() })
const posts = table('posts', {
  id: serial().primaryKey(),
  userId: integer().notNull(),
  title: text(),
})

describe.each(targets)('kick/db on %s', (_name, open) => {
  let dir: string
  let target: Target

  beforeEach(async () => {
    dir = await mkdtemp(path.join(here, '../fixtures/tmp-async-sqlite-'))
    target = await open(dir)
  })
  afterEach(async () => {
    await target.close()
    await rm(dir, { recursive: true, force: true })
  })

  async function migrateTo(schema: string, name: string) {
    await writeFile(path.join(dir, 'schema.ts'), schema)
    const config = {
      schemaPath: path.join(dir, 'schema.ts'),
      migrationsDir: path.join(dir, 'migrations'),
      dialect: 'sqlite' as const,
    }
    await generate({ name, config, cwd: dir })
    return migrateLatest({
      adapter: asyncSqliteAdapter({ driver: target.driver }),
      migrationsDir: config.migrationsDir,
      requireReviewed: false,
    })
  }

  it('migrates, queries, rebuilds a table keeping its rows, and introspects', async () => {
    expect((await migrateTo(schemaV1, 'init')).applied).toHaveLength(1)

    const db = createDbClient({ schema: { users, posts }, dialect: target.dialect })
    expect(db.dialect).toBe('sqlite')
    const { id } = await db
      .insertInto('users')
      .values({ email: 'ada@x.io' })
      .returning('id')
      .executeTakeFirstOrThrow()
    await db.insertInto('posts').values({ userId: id, title: 'hello' }).execute()
    expect(await db.selectFrom('posts').select(['userId', 'title']).execute()).toEqual([
      { userId: id, title: 'hello' },
    ])

    const rebuild = await migrateTo(schemaV2, 'title_required')
    expect(rebuild.applied).toHaveLength(1)
    const up = await readFile(path.join(dir, 'migrations', rebuild.applied[0], 'up.sql'), 'utf8')
    expect(up).toContain('"_kick_new_posts"')
    expect(await db.selectFrom('posts').select('title').execute()).toEqual([{ title: 'hello' }])

    const live = await asyncSqliteAdapter({ driver: target.driver }).introspect()
    expect(Object.keys(live.tables).toSorted()).toEqual(['posts', 'users'])
    expect(live.tables.posts.columns.title.nullable).toBe(false)
    expect(live.tables.posts.foreignKeys[0]).toMatchObject({ refTable: 'users' })
  })

  it('applies a migration all or nothing', async () => {
    const adapter = asyncSqliteAdapter({ driver: target.driver })
    await adapter.ensureMigrationTables()
    await expect(
      adapter.applyMigrationInTx!('CREATE TABLE a (id INTEGER); SELECT * FROM missing;', {
        record: { id: 'm1', name: 'm1', hash: 'h', batch: 1, direction: 'up' },
      }),
    ).rejects.toThrow()
    expect(await adapter.listApplied()).toEqual([])
    expect(await target.driver.query(`SELECT name FROM sqlite_master WHERE name = 'a'`)).toEqual([])
  })

  it('takes the migration lock once', async () => {
    const adapter = asyncSqliteAdapter({ driver: target.driver })
    await adapter.ensureMigrationTables()
    expect(await adapter.acquireLock('one')).toBe(true)
    expect(await adapter.acquireLock('two')).toBe(false)
    await adapter.releaseLock()
    expect(await adapter.acquireLock('two')).toBe(true)
  })
})

describe('the foreign-key guard after a table rebuild', () => {
  it('rolls back a rebuild that leaves a broken foreign key', async () => {
    const client = createClient({ url: ':memory:' })
    try {
      // With enforcement on, the copy itself is refused; the guard covers
      // connections where it's off.
      await client.execute('PRAGMA foreign_keys = OFF')
      const adapter = asyncSqliteAdapter({ driver: libsqlDriver(client) })
      await adapter.ensureMigrationTables()
      await client.execute('CREATE TABLE parents (id INTEGER PRIMARY KEY)')
      await expect(
        adapter.applyMigrationInTx!(
          `CREATE TABLE "_kick_new_kids" (id INTEGER, parent_id INTEGER REFERENCES parents(id));
           INSERT INTO "_kick_new_kids" VALUES (1, 99);
           ALTER TABLE "_kick_new_kids" RENAME TO "kids";`,
          { record: { id: 'm1', name: 'm1', hash: 'h', batch: 1, direction: 'up' } },
        ),
      ).rejects.toThrow(/foreign key points at a missing row/)
      expect(await adapter.listApplied()).toEqual([])
    } finally {
      client.close()
    }
  })
})

describe('TypeScript migrations on libsql', () => {
  it('run with the Kysely instance passed to the adapter, in a transaction', async () => {
    const dir = await mkdtemp(path.join(here, '../fixtures/tmp-async-sqlite-'))
    const client = createClient({ url: `file:${path.join(dir, 'app.db')}` })
    try {
      await writeFile(path.join(dir, 'schema.ts'), schemaV1)
      const config = {
        schemaPath: path.join(dir, 'schema.ts'),
        migrationsDir: path.join(dir, 'migrations'),
        dialect: 'sqlite' as const,
      }
      const adapter = asyncSqliteAdapter({
        driver: libsqlDriver(client),
        kysely: new Kysely({ dialect: new LibsqlDialect({ client }) }),
      })
      await generate({ name: 'init', config, cwd: dir })
      const code = await generate({ name: 'seed', config, cwd: dir, typescript: true })
      await writeFile(
        path.join(code.migrationDir!, 'migration.ts'),
        `export async function up(db) {
  await db.insertInto('users').values({ email: 'seeded@x.io' }).execute()
}`,
      )
      const run = await migrateLatest({
        adapter,
        migrationsDir: config.migrationsDir,
        requireReviewed: false,
      })
      expect(run.applied).toHaveLength(2)
      expect((await client.execute('SELECT email FROM users')).rows.map((r) => r.email)).toEqual([
        'seeded@x.io',
      ])
    } finally {
      client.close()
      await rm(dir, { recursive: true, force: true })
    }
  })
})
