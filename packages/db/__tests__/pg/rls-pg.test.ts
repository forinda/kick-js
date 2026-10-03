/**
 * D.26 on Postgres: policies and a role declared in the schema, migrated,
 * enforced per request through transaction({ settings, role }), kept across
 * a change to a column they use, and introspected without drift.
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
  serial,
  table,
  text,
} from '@forinda/kickjs-db'
import { pgAdapter, pgDialect } from '@forinda/kickjs-db/pg'

const here = path.dirname(fileURLToPath(import.meta.url))
// nullif: once set on a connection, an unset custom setting reads '' rather than NULL.
const owner = `"ownerId" = nullif(current_setting('app.user_id', true), '')::int`
const schemaV1 = `import { integer, serial, table, text } from '@forinda/kickjs-db'
import { pgRole, policy } from '@forinda/kickjs-db/pg'
export const reader = pgRole('docs_reader')
export const docs = table('docs', { id: serial().primaryKey(), ownerId: integer().notNull(), body: text() }, {
  rls: { force: true },
  constraints: () => ({
    own: policy('docs_own').using(${JSON.stringify(owner)}).withCheck(${JSON.stringify(owner)}),
    readAll: policy('docs_read_all').for('select').to(reader).using('true'),
  }),
})`
// A type change on a column a policy uses: Postgres refuses unless the policy is dropped first.
const schemaV2 = schemaV1
  .replace('import { integer,', 'import { bigint, integer,')
  .replace('ownerId: integer().notNull()', "ownerId: bigint({ mode: 'number' }).notNull()")

let container: StartedPostgreSqlContainer
let pool: pg.Pool
let dir: string

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start()
  // A superuser bypasses row-level security even when forced, so the app
  // connects as an ordinary role that owns its database.
  const admin = new pg.Client({ connectionString: container.getConnectionUri() })
  await admin.connect()
  await admin.query(`CREATE ROLE app LOGIN PASSWORD 'app' CREATEROLE`)
  await admin.query('CREATE DATABASE app OWNER app')
  await admin.end()
  const url = new URL(container.getConnectionUri())
  url.username = 'app'
  url.password = 'app'
  url.pathname = '/app'
  pool = new pg.Pool({ connectionString: url.toString() })
  dir = await mkdtemp(path.join(here, '../fixtures/tmp-rls-pg-'))
}, 120_000)
afterAll(async () => {
  await pool?.end()
  await container?.stop()
  if (dir) await rm(dir, { recursive: true, force: true })
}, 60_000)

const docsTable = table('docs', {
  id: serial().primaryKey(),
  ownerId: integer().notNull(),
  body: text(),
})

describe('row-level security on Postgres', () => {
  it('is migrated, enforced per request, and introspected', async () => {
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

    const db = createDbClient({ schema: { docs: docsTable }, dialect: pgDialect({ pool }) })
    const as = (userId: number) => ({ settings: { 'app.user_id': userId } })
    await db.transaction(as(1), (tx) =>
      tx.insertInto('docs').values({ ownerId: 1, body: 'mine' }).execute(),
    )
    await db.transaction(as(2), (tx) =>
      tx.insertInto('docs').values({ ownerId: 2, body: 'theirs' }).execute(),
    )
    // FORCE: the owner connection sees only what the policy allows.
    expect(await db.selectFrom('docs').selectAll().execute()).toEqual([])
    expect(
      await db.transaction(as(1), (tx) => tx.selectFrom('docs').select('body').execute()),
    ).toEqual([{ body: 'mine' }])
    await expect(
      db.transaction(as(1), (tx) =>
        tx.insertInto('docs').values({ ownerId: 2, body: 'x' }).execute(),
      ),
    ).rejects.toThrow(/row-level security/)

    // As the declared role (granted read here; grants stay outside the schema).
    await pool.query('GRANT SELECT ON docs TO docs_reader')
    // INHERIT FALSE: the app may SET ROLE to it, without its policies applying to every query.
    await pool.query(`GRANT docs_reader TO CURRENT_USER WITH INHERIT FALSE`)
    expect(
      await db.transaction({ role: 'docs_reader' }, (tx) =>
        tx.selectFrom('docs').select('body').orderBy('body').execute(),
      ),
    ).toEqual([{ body: 'mine' }, { body: 'theirs' }])
    await expect(
      db.transaction({ role: 'docs_reader' }, async (tx) =>
        db.transaction({ settings: { 'app.user_id': 1 } }, () => tx.selectFrom('docs').execute()),
      ),
    ).rejects.toThrow(/nested: 'separate'/)

    expect((await migrateTo(schemaV2, 'body_required')).applied).toHaveLength(1)
    expect(
      await db.transaction(as(2), (tx) => tx.selectFrom('docs').select('body').execute()),
    ).toEqual([{ body: 'theirs' }])

    const live = await adapter.introspect()
    expect(live.tables.docs.rls).toEqual({ force: true })
    expect(live.tables.docs.policies?.map((p) => [p.name, p.command, p.to])).toEqual([
      ['docs_own', 'all', ['public']],
      ['docs_read_all', 'select', ['docs_reader']],
    ])
    await expect(
      checkDrift(live, extractSnapshot(await import(config.schemaPath), 'postgres'), 'error'),
    ).resolves.toBeUndefined()
    expect(renderSchemaSource(live)).toContain(
      "policy('docs_read_all').for('select').to('docs_reader')",
    )
  })
})
