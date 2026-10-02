/**
 * D.9 richer indexes against a real Postgres: generated migrations apply,
 * the indexes enforce what they say, CONCURRENTLY runs outside a
 * transaction, and introspection reads them back without phantom drift.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import pg from 'pg'
import { checkDrift, generate, migrateLatest, renderSchemaSource } from '@forinda/kickjs-db'
import { pgAdapter } from '@forinda/kickjs-db/pg'

const here = path.dirname(fileURLToPath(import.meta.url))
let container: StartedPostgreSqlContainer
let pool: pg.Pool
let dir: string

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start()
  pool = new pg.Pool({ connectionString: container.getConnectionUri() })
  pool.on('error', () => {})
  await pool.query('CREATE EXTENSION pg_trgm')
  dir = await mkdtemp(path.join(here, '../fixtures/tmp-indexes-pg-'))
}, 120_000)

afterAll(async () => {
  await pool?.end()
  await container?.stop()
  if (dir) await rm(dir, { recursive: true, force: true })
}, 60_000)

const schema = (extra = '') => `
import { index, integer, serial, table, text, timestamp, unique } from '@forinda/kickjs-db'
export const docs = table(
  'docs',
  { id: serial().primaryKey(), email: text().notNull(), title: text().notNull(), ownerId: integer().notNull(), deletedAt: timestamp() },
  (t) => ({
    active: unique('docs_email_active').on(t.email).where('"deletedAt" IS NULL'),
    lower: unique('docs_email_lower_title').on('lower(email)', t.title),
    trgm: index('docs_title_trgm').on(t.title).using('gin').op(t.title, 'gin_trgm_ops'),
    cover: index('docs_owner_cover').on(t.ownerId).include(t.title),${extra}
  }),
)
`

describe('richer indexes on Postgres', () => {
  it('applies, enforces, builds concurrently and introspects without drift', async () => {
    const adapter = pgAdapter({ pool })
    const migrationsDir = path.join(dir, 'migrations')
    let clock = Date.UTC(2026, 9, 3, 12, 0, 0)
    const now = () => new Date(clock)
    const run = () => migrateLatest({ adapter, migrationsDir, requireReviewed: false })

    await writeFile(path.join(dir, 'v1.ts'), schema())
    const cfg = (file: string) => ({
      schemaPath: path.join(dir, file),
      migrationsDir,
      dialect: 'postgres' as const,
    })
    await generate({ name: 'init', config: cfg('v1.ts'), cwd: dir, now })
    await run()

    const insert = (email: string, title: string, deleted = false) =>
      pool.query(`INSERT INTO docs (email, title, "ownerId", "deletedAt") VALUES ($1, $2, 1, $3)`, [
        email,
        title,
        deleted ? new Date() : null,
      ])
    await insert('a@x.io', 'one', true)
    await insert('a@x.io', 'two') // the deleted row is outside the partial index
    await expect(insert('a@x.io', 'three')).rejects.toThrow(/docs_email_active/)
    await expect(insert('B@x.io', 'two')).resolves.toBeDefined()
    await expect(insert('b@x.io', 'two', true)).rejects.toThrow(/docs_email_lower_title/)

    // A concurrent index: its own migration, outside a transaction. Inside
    // one, Postgres refuses CREATE INDEX CONCURRENTLY.
    clock += 60_000
    await writeFile(
      path.join(dir, 'v2.ts'),
      schema(`\n    owner: index('docs_owner').on(t.ownerId).concurrently(),`),
    )
    await generate({ name: 'owner', config: cfg('v2.ts'), cwd: dir, now })
    await run()
    // Runs again with the default drift check, which reads the live schema.
    await run()

    const live = await adapter.introspect()
    const ix = Object.fromEntries(live.tables.docs.indexes.map((i) => [i.name, i]))
    expect(ix.docs_email_active).toMatchObject({ unique: true, columns: ['email'] })
    expect(ix.docs_email_active.where).toMatch(/"deletedAt" IS NULL/)
    expect(ix.docs_email_lower_title.columns).toEqual(['(lower(email))', 'title'])
    expect(ix.docs_title_trgm.using).toBe('gin')
    expect(ix.docs_owner_cover).toMatchObject({ columns: ['ownerId'], include: ['title'] })
    expect(ix.docs_owner).toEqual({ name: 'docs_owner', columns: ['ownerId'], unique: false })

    const ids = (await readdir(migrationsDir)).filter((e) => e !== '_journal.json').toSorted()
    const expected = JSON.parse(
      await readFile(path.join(migrationsDir, ids.at(-1)!, 'snapshot.json'), 'utf8'),
    )
    await expect(checkDrift(live, expected, 'error')).resolves.toBeUndefined()

    const src = renderSchemaSource(live)
    expect(src).toContain(`.on('lower(email)', t.title)`)
    expect(src).toContain(`.using('gin')`)
    expect(src).toContain(`.include(t.title)`)
  }, 120_000)
})
