/**
 * D.27: migrations from files in memory (`migrationFiles()`), as a bundled
 * deploy has them — applied, hashed and reviewed like a folder's.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'
import {
  generate,
  migrateDown,
  migrateLatest,
  migrateStatus,
  migrationFiles,
  reviewMigration,
} from '@forinda/kickjs-db'
import { sqliteAdapter } from '@forinda/kickjs-db/sqlite'

const here = path.dirname(fileURLToPath(import.meta.url))
let dir: string
let migrationsDir: string

beforeEach(async () => {
  dir = await mkdtemp(path.join(here, '../fixtures/tmp-bundled-'))
  migrationsDir = path.join(dir, 'migrations')
  await writeFile(
    path.join(dir, 'schema.ts'),
    `import { serial, table, text } from '@forinda/kickjs-db'
export const users = table('users', { id: serial().primaryKey(), email: text().notNull(), status: text() })`,
  )
  const config = {
    schemaPath: path.join(dir, 'schema.ts'),
    migrationsDir,
    dialect: 'sqlite' as const,
  }
  const init = await generate({
    name: 'init',
    config,
    cwd: dir,
    now: () => new Date(Date.UTC(2026, 9, 6, 12)),
  })
  await reviewMigration(migrationsDir, path.basename(init.migrationDir!))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

/** Every file under the folder as text, keyed the way import.meta.glob keys them. */
async function globRaw(): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  for (const entry of await readdir(migrationsDir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue
    const file = path.join(entry.parentPath, entry.name)
    out[`../../db/migrations/${path.relative(migrationsDir, file)}`] = await readFile(file, 'utf8')
  }
  return out
}

const fresh = () => {
  const database = new Database(':memory:')
  return { database, adapter: sqliteAdapter({ database }) }
}

describe('migrationFiles()', () => {
  it('applies, reports and reverses bundled migrations', async () => {
    const { database, adapter } = fresh()
    const migrations = migrationFiles(await globRaw())
    const { applied } = await migrateLatest({ adapter, migrationsDir: migrations })
    expect(applied).toHaveLength(1)
    expect(
      database.prepare(`select name from sqlite_master where name = 'users'`).get(),
    ).toBeTruthy()

    const status = await migrateStatus({ adapter, migrationsDir: migrations })
    expect(status).toMatchObject([{ state: 'applied', reviewed: true }])

    await migrateDown({ adapter, migrationsDir: migrations })
    expect(
      database.prepare(`select name from sqlite_master where name = 'users'`).get(),
    ).toBeUndefined()
  })

  it('refuses a reviewed migration whose bundled text changed', async () => {
    const files = await globRaw()
    const up = Object.keys(files).find((f) => f.endsWith('/up.sql'))!
    files[up] += '\nDROP TABLE users;'
    await expect(
      migrateLatest({ ...fresh(), migrationsDir: migrationFiles(files) }),
    ).rejects.toThrow(/hash/i)
  })

  it('runs a TypeScript migration from its module, hashed from its text', async () => {
    const r = await generate({
      name: 'backfill',
      config: { schemaPath: path.join(dir, 'schema.ts'), migrationsDir, dialect: 'sqlite' },
      cwd: dir,
      now: () => new Date(Date.UTC(2026, 9, 6, 13)),
      typescript: true,
    })
    const id = path.basename(r.migrationDir!)
    const source = `export async function up(db) {
  await db.insertInto('users').values({ email: 'a@x.io', status: 'active' }).execute()
}`
    await writeFile(path.join(migrationsDir, id, 'migration.ts'), source)
    await reviewMigration(migrationsDir, id)

    const { database, adapter } = fresh()
    const module = {
      up: async (db: any) => {
        await db.insertInto('users').values({ email: 'a@x.io', status: 'active' }).execute()
      },
    }
    const migrations = migrationFiles(await globRaw(), {
      [`../../db/migrations/${id}/migration.ts`]: module,
    })
    expect((await migrateLatest({ adapter, migrationsDir: migrations })).applied).toContain(id)
    expect(database.prepare('select email, status from users').all()).toEqual([
      { email: 'a@x.io', status: 'active' },
    ])

    // Its text is in the bundle but its module isn't.
    await expect(
      migrateLatest({ ...fresh(), migrationsDir: migrationFiles(await globRaw()) }),
    ).rejects.toThrow(/pass its module/)
  })

  it('refuses a file that is not text', () => {
    expect(() =>
      migrationFiles({ '../../db/migrations/_journal.json': { version: 1 } as never }),
    ).toThrow(/\?raw/)
  })

  it('runs alongside a folder as one history', async () => {
    const { adapter } = fresh()
    const other = await mkdtemp(path.join(here, '../fixtures/tmp-bundled-other-'))
    try {
      const { applied } = await migrateLatest({
        adapter,
        migrationsDir: [migrationFiles(await globRaw()), other],
      })
      expect(applied).toHaveLength(1)
    } finally {
      await rm(other, { recursive: true, force: true })
    }
  })
})
