/** D.18 on Postgres: a TypeScript migration runs on its transaction, and rolls back whole. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import pg from 'pg'
import { generate, migrateDown, migrateLatest } from '@forinda/kickjs-db'
import { pgAdapter } from '@forinda/kickjs-db/pg'

const here = path.dirname(fileURLToPath(import.meta.url))
let container: StartedPostgreSqlContainer
let pool: pg.Pool
let dir: string

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start()
  pool = new pg.Pool({ connectionString: container.getConnectionUri() })
  pool.on('error', () => {})
  dir = await mkdtemp(path.join(here, '../fixtures/tmp-code-migrations-pg-'))
}, 120_000)

afterAll(async () => {
  await pool?.end()
  await container?.stop()
  if (dir) await rm(dir, { recursive: true, force: true })
}, 60_000)

describe('TypeScript migrations on Postgres', () => {
  it('apply, record, fail atomically, and reverse', async () => {
    await writeFile(
      path.join(dir, 'schema.ts'),
      `import { serial, table, text } from '@forinda/kickjs-db'
export const users = table('users', { id: serial().primaryKey(), email: text().notNull(), status: text() })`,
    )
    const adapter = pgAdapter({ pool })
    const config = {
      schemaPath: path.join(dir, 'schema.ts'),
      migrationsDir: path.join(dir, 'migrations'),
      dialect: 'postgres' as const,
    }
    let clock = Date.UTC(2026, 9, 3, 12, 0, 0)
    const now = () => new Date((clock += 60_000))
    const opts = { adapter, migrationsDir: config.migrationsDir, requireReviewed: false }
    await generate({ name: 'init', config, cwd: dir, now })
    await migrateLatest(opts)
    await pool.query(`INSERT INTO users (email) VALUES ('a@x.io')`)

    const r = await generate({ name: 'backfill', config, cwd: dir, now, typescript: true })
    const file = path.join(r.migrationDir!, 'migration.ts')
    await writeFile(
      file,
      `export async function up(db) {
  await db.updateTable('users').set({ status: 'active' }).execute()
  throw new Error('stop')
}`,
    )
    await expect(migrateLatest(opts)).rejects.toThrow(/failed: stop/)
    expect((await pool.query('SELECT status FROM users')).rows).toEqual([{ status: null }])

    await writeFile(
      file,
      `export async function up(db) { await db.updateTable('users').set({ status: 'active' }).execute() }
export async function down(db) { await db.updateTable('users').set({ status: null }).execute() }`,
    )
    await migrateLatest(opts)
    expect((await pool.query('SELECT status FROM users')).rows).toEqual([{ status: 'active' }])
    await migrateDown(opts)
    expect((await pool.query('SELECT status FROM users')).rows).toEqual([{ status: null }])
  }, 60_000)
})
