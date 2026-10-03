/**
 * D.25 on Postgres: a view and a materialized view, migrated, queried,
 * refreshed (concurrently, through its unique index), kept across a change
 * to a column they use, and introspected without drift.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import pg from 'pg'
import {
  checkDrift,
  createDbClient,
  extractSnapshot,
  generate,
  integer,
  migrateLatest,
  renderSchemaSource,
  text,
  view,
} from '@forinda/kickjs-db'
import { materializedView, pgAdapter, pgDialect } from '@forinda/kickjs-db/pg'

const here = path.dirname(fileURLToPath(import.meta.url))
const schemaV1 = `import { integer, serial, table, text, unique, varchar, view } from '@forinda/kickjs-db'
import { materializedView } from '@forinda/kickjs-db/pg'
export const users = table('users', { id: serial().primaryKey(), email: varchar(100).notNull(), active: integer().notNull() })
export const activeUsers = view('active_users', { id: integer().notNull(), email: text().notNull() }, {
  as: 'SELECT id, email FROM users WHERE active = 1',
})
export const userCount = materializedView('user_count', { active: integer().notNull(), n: integer().notNull() }, {
  as: 'SELECT active, count(*)::int AS n FROM users GROUP BY active',
  constraints: (t) => ({ byActive: unique('user_count_active').on(t.active) }),
})`
// Widening a column both views read: Postgres refuses unless they're dropped first.
const schemaV2 = schemaV1
  .replace('email: varchar(100)', 'email: varchar(200)')
  .replace(
    'active: integer().notNull() })',
    "active: integer().notNull() }, { comment: 'People' })",
  )

let container: StartedPostgreSqlContainer
let pool: pg.Pool
let dir: string

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start()
  pool = new pg.Pool({ connectionString: container.getConnectionUri() })
  dir = await mkdtemp(path.join(here, '../fixtures/tmp-views-pg-'))
}, 120_000)
afterAll(async () => {
  await pool?.end()
  await container?.stop()
  if (dir) await rm(dir, { recursive: true, force: true })
}, 60_000)

describe('views on Postgres', () => {
  it('migrate, query, refresh, survive a column change, and introspect without drift', async () => {
    const adapter = pgAdapter({ pool })
    const config = {
      schemaPath: path.join(dir, 'schema.ts'),
      migrationsDir: path.join(dir, 'migrations'),
      dialect: 'postgres' as const,
    }
    const migrateTo = async (schema: string, name: string) => {
      await writeFile(config.schemaPath, schema)
      await generate({ name, config, cwd: dir })
      return migrateLatest({ adapter, migrationsDir: config.migrationsDir, requireReviewed: false })
    }
    expect((await migrateTo(schemaV1, 'init')).applied).toHaveLength(1)
    await pool.query(
      `INSERT INTO users (email, active) VALUES ('a@x.io', 1), ('b@x.io', 0), ('c@x.io', 1)`,
    )

    const activeUsers = view(
      'active_users',
      { id: integer().notNull(), email: text().notNull() },
      { as: 'SELECT id, email FROM users WHERE active = 1' },
    )
    const userCount = materializedView(
      'user_count',
      { active: integer().notNull(), n: integer().notNull() },
      { as: 'SELECT active, count(*)::int AS n FROM users GROUP BY active' },
    )
    const db = createDbClient({ schema: { activeUsers, userCount }, dialect: pgDialect({ pool }) })
    expect(await db.selectFrom('active_users').select('email').orderBy('email').execute()).toEqual([
      { email: 'a@x.io' },
      { email: 'c@x.io' },
    ])
    // Created WITH DATA before these rows existed: empty until refreshed.
    expect(await db.selectFrom('user_count').selectAll().execute()).toEqual([])
    await db.refreshMaterializedView('user_count', { concurrently: true })
    expect(await db.selectFrom('user_count').selectAll().orderBy('active').execute()).toEqual([
      { active: 0, n: 1 },
      { active: 1, n: 2 },
    ])

    expect((await migrateTo(schemaV2, 'wider_email')).applied).toHaveLength(1)
    expect(await db.selectFrom('active_users').select('email').execute()).toHaveLength(2)

    const live = await adapter.introspect()
    expect(Object.keys(live.views!)).toEqual(['active_users', 'user_count'])
    expect(live.views!.user_count).toMatchObject({ materialized: true })
    expect(live.views!.user_count.indexes?.[0]).toMatchObject({
      name: 'user_count_active',
      unique: true,
    })
    expect(live.views!.active_users.columns!.email.type).toBe('varchar(200)')
    await expect(
      checkDrift(live, extractSnapshot(await import(config.schemaPath), 'postgres'), 'error'),
    ).resolves.toBeUndefined()
    const src = renderSchemaSource(live)
    expect(src).toContain("export const user_count = materializedView('user_count', {")
    expect(src).toContain("import { materializedView } from '@forinda/kickjs-db/pg'")
  })
})
