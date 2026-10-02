/** D.18 on MySQL 8: a TypeScript migration runs on its transaction, and rolls back whole. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { MySqlContainer, type StartedMySqlContainer } from '@testcontainers/mysql'
import { createPool, type Pool } from 'mysql2/promise'
import { generate, migrateDown, migrateLatest } from '@forinda/kickjs-db'
import { mysqlAdapter } from '@forinda/kickjs-db/mysql'

const here = path.dirname(fileURLToPath(import.meta.url))
let container: StartedMySqlContainer
let pool: Pool
let dir: string

beforeAll(async () => {
  container = await new MySqlContainer('mysql:8.0').start()
  pool = createPool({
    host: container.getHost(),
    port: container.getPort(),
    user: 'root',
    password: container.getRootPassword(),
    database: container.getDatabase(),
    multipleStatements: true,
  })
  dir = await mkdtemp(path.join(here, '../fixtures/tmp-code-migrations-mysql-'))
}, 180_000)

afterAll(async () => {
  await pool?.end()
  await container?.stop()
  if (dir) await rm(dir, { recursive: true, force: true })
}, 60_000)

describe('TypeScript migrations on MySQL', () => {
  it('apply, record, fail atomically, and reverse', async () => {
    await writeFile(
      path.join(dir, 'schema.ts'),
      `import { serial, table, varchar } from '@forinda/kickjs-db'
export const users = table('users', { id: serial().primaryKey(), email: varchar(100).notNull(), status: varchar(20) })`,
    )
    const adapter = mysqlAdapter({ pool })
    const config = {
      schemaPath: path.join(dir, 'schema.ts'),
      migrationsDir: path.join(dir, 'migrations'),
      dialect: 'mysql' as const,
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
    expect((await pool.query('SELECT status FROM users'))[0]).toEqual([{ status: null }])

    await writeFile(
      file,
      `export async function up(db) { await db.updateTable('users').set({ status: 'active' }).execute() }
export async function down(db) { await db.updateTable('users').set({ status: null }).execute() }`,
    )
    await migrateLatest(opts)
    expect((await pool.query('SELECT status FROM users'))[0]).toEqual([{ status: 'active' }])
    await migrateDown(opts)
    expect((await pool.query('SELECT status FROM users'))[0]).toEqual([{ status: null }])
  }, 60_000)
})
