/**
 * D.18: migrations written in TypeScript. `generate({ typescript })` writes a
 * migration.ts; the runner runs up()/down() on the migration's transaction
 * with its bookkeeping, and hashes the code like the SQL.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'
import { generate, migrateDown, migrateLatest, reviewMigration } from '@forinda/kickjs-db'
import { sqliteAdapter } from '@forinda/kickjs-db/sqlite'

const here = path.dirname(fileURLToPath(import.meta.url))
let dir: string

beforeEach(async () => {
  dir = await mkdtemp(path.join(here, '../fixtures/tmp-code-migrations-'))
  await writeFile(
    path.join(dir, 'schema.ts'),
    `import { serial, table, text } from '@forinda/kickjs-db'
export const users = table('users', { id: serial().primaryKey(), email: text().notNull(), status: text() })`,
  )
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

async function setup() {
  const database = new Database(':memory:')
  const adapter = sqliteAdapter({ database })
  const config = {
    schemaPath: path.join(dir, 'schema.ts'),
    migrationsDir: path.join(dir, 'migrations'),
    dialect: 'sqlite' as const,
  }
  let clock = Date.UTC(2026, 9, 3, 12, 0, 0)
  const now = () => new Date((clock += 60_000))
  await generate({ name: 'init', config, cwd: dir, now })
  const run = () =>
    migrateLatest({ adapter, migrationsDir: config.migrationsDir, requireReviewed: false })
  await run()
  database.exec(`INSERT INTO users (email) VALUES ('a@x.io'), ('b@x.io')`)

  const r = await generate({ name: 'backfill', config, cwd: dir, now, typescript: true })
  const id = path.basename(r.migrationDir!)
  const file = path.join(config.migrationsDir, id, 'migration.ts')
  return { database, adapter, config, run, id, file }
}

const statuses = (database: Database.Database) =>
  database.prepare('SELECT status FROM users ORDER BY id').all()

describe('migrations written in TypeScript', () => {
  it('generate writes migration.ts and keeps the snapshot', async () => {
    const { config, id, file } = await setup()
    const code = await readFile(file, 'utf8')
    expect(code).toContain('export async function up(db: MigrationDb)')
    expect(code).toContain("import type { MigrationDb } from '@forinda/kickjs-db'")
    const ids = (await readdir(config.migrationsDir))
      .filter((e) => e !== '_journal.json')
      .toSorted()
    const snap = (i: string) =>
      readFile(path.join(config.migrationsDir, i, 'snapshot.json'), 'utf8')
    expect(await snap(id)).toBe(await snap(ids[0]))
  })

  it('runs up() and down() with their bookkeeping', async () => {
    const { database, adapter, config, run, id, file } = await setup()
    await writeFile(
      file,
      `export async function up(db) {
  await db.updateTable('users').set({ status: 'active' }).where('status', 'is', null).execute()
}
export async function down(db) {
  await db.updateTable('users').set({ status: null }).execute()
}`,
    )
    expect((await run()).applied).toEqual([id])
    expect(statuses(database)).toEqual([{ status: 'active' }, { status: 'active' }])
    expect(database.prepare('SELECT id FROM kick_migrations WHERE id = ?').get(id)).toEqual({ id })

    await migrateDown({ adapter, migrationsDir: config.migrationsDir, requireReviewed: false })
    expect(statuses(database)).toEqual([{ status: null }, { status: null }])
    expect(database.prepare('SELECT id FROM kick_migrations WHERE id = ?').get(id)).toBeUndefined()
  })

  it('runs with a relative migrationsDir, as kick.config.ts gives it', async () => {
    const { database, adapter, config, id, file } = await setup()
    await writeFile(
      file,
      `export async function up(db) {
  await db.updateTable('users').set({ status: 'active' }).execute()
}`,
    )
    const migrationsDir = path.relative(process.cwd(), config.migrationsDir)
    expect(
      (await migrateLatest({ adapter, migrationsDir, requireReviewed: false })).applied,
    ).toEqual([id])
    expect(statuses(database)).toEqual([{ status: 'active' }, { status: 'active' }])
  })

  it('a failing up() leaves neither its changes nor a record', async () => {
    const { database, run, id, file } = await setup()
    await writeFile(
      file,
      `export async function up(db) {
  await db.updateTable('users').set({ status: 'half' }).execute()
  throw new Error('backfill failed')
}`,
    )
    await expect(run()).rejects.toThrow(`Migration ${id} failed: backfill failed`)
    expect(statuses(database)).toEqual([{ status: null }, { status: null }])
    expect(database.prepare('SELECT id FROM kick_migrations WHERE id = ?').get(id)).toBeUndefined()
  })

  it('an edit to migration.ts after review is refused', async () => {
    const { config, run, id, file } = await setup()
    await writeFile(file, `export async function up() {}`)
    await reviewMigration(config.migrationsDir, id)
    await writeFile(file, `export async function up(db) { await db.deleteFrom('users').execute() }`)
    await expect(run()).rejects.toThrow(/hash/i)
  })
})
