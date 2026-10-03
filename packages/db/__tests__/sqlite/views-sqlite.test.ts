/**
 * D.25 on SQLite: a view is migrated after its table, queried through the
 * typed client, survives its table being rebuilt, and introspects back.
 */
import { afterEach, beforeEach, describe, expect, expectTypeOf, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'
import {
  checkDrift,
  createDbClient,
  extractSnapshot,
  generate,
  integer,
  migrateLatest,
  text,
  view,
} from '@forinda/kickjs-db'
import { sqliteAdapter, sqliteDialect } from '@forinda/kickjs-db/sqlite'

const here = path.dirname(fileURLToPath(import.meta.url))
const schemaV1 = `import { integer, serial, table, text, view } from '@forinda/kickjs-db'
export const users = table('users', { id: serial().primaryKey(), email: text().notNull(), active: integer().notNull() })
export const activeUsers = view('active_users', { id: integer().notNull(), email: text().notNull() }, {
  as: 'SELECT id, email FROM users WHERE active = 1',
})`
// A default on an existing column: SQLite rebuilds the table under the view.
const schemaV2 = schemaV1.replace(
  'active: integer().notNull()',
  'active: integer().notNull().default(1)',
)

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(path.join(here, '../fixtures/tmp-views-sqlite-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('views on SQLite', () => {
  it('migrate, query, survive a table rebuild, and introspect without drift', async () => {
    const database = new Database(':memory:')
    const adapter = sqliteAdapter({ database })
    const config = {
      schemaPath: path.join(dir, 'schema.ts'),
      migrationsDir: path.join(dir, 'migrations'),
      dialect: 'sqlite' as const,
    }
    const migrateTo = async (schema: string, name: string) => {
      await writeFile(config.schemaPath, schema)
      await generate({ name, config, cwd: dir })
      return migrateLatest({ adapter, migrationsDir: config.migrationsDir, requireReviewed: false })
    }

    expect((await migrateTo(schemaV1, 'init')).applied).toHaveLength(1)
    database.exec(`INSERT INTO users (email, active) VALUES ('a@x.io', 1), ('b@x.io', 0)`)

    const activeUsers = view(
      'active_users',
      { id: integer().notNull(), email: text().notNull() },
      { as: 'SELECT id, email FROM users WHERE active = 1' },
    )
    const db = createDbClient({ schema: { activeUsers }, dialect: sqliteDialect({ database }) })
    const rows = await db.selectFrom('active_users').selectAll().execute()
    expect(rows).toEqual([{ id: 1, email: 'a@x.io' }])
    expectTypeOf(rows[0]!.email).toEqualTypeOf<string>()

    expect((await migrateTo(schemaV2, 'active_default')).applied).toHaveLength(1)
    expect(await db.selectFrom('active_users').select('email').execute()).toEqual([
      { email: 'a@x.io' },
    ])

    const live = await adapter.introspect()
    expect(live.views?.active_users).toMatchObject({
      definition: 'SELECT id, email FROM users WHERE active = 1',
    })
    expect(Object.keys(live.views!.active_users.columns!)).toEqual(['id', 'email'])
    await expect(
      checkDrift(live, extractSnapshot(await import(config.schemaPath), 'sqlite'), 'error'),
    ).resolves.toBeUndefined()
  })
})
