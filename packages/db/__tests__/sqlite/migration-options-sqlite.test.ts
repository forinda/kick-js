/**
 * D.22 migration options on SQLite: up/down to a named migration, rollback
 * of everything, a custom migrations table, and several migration folders.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'
import {
  createDbClient,
  generate,
  migrateDown,
  migrateLatest,
  migrateRollback,
  migrateStatus,
  migrateUp,
  serial,
  table,
  text,
} from '@forinda/kickjs-db'
import { sqliteAdapter, sqliteDialect } from '@forinda/kickjs-db/sqlite'
import { resolveKickDbConfig } from '../../src/cli'

const here = path.dirname(fileURLToPath(import.meta.url))
let dir: string
let clock: number
let fileCount = 0
const now = () => new Date((clock += 60_000))

beforeEach(async () => {
  dir = await mkdtemp(path.join(here, '../fixtures/tmp-migration-options-'))
  clock = Date.UTC(2026, 9, 3, 12, 0, 0)
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

/** Generate one migration per schema version into `folder`. */
async function history(folder: string, versions: string[]): Promise<string[]> {
  const ids: string[] = []
  for (const [n, body] of versions.entries()) {
    // A fresh file each time: the loader caches a module by path.
    const file = path.join(dir, `schema-${(fileCount += 1)}-v${n}.ts`)
    await writeFile(file, `import { serial, table, text } from '@forinda/kickjs-db'\n${body}`)
    const r = await generate({
      name: `step_${n}`,
      config: { schemaPath: file, migrationsDir: folder, dialect: 'sqlite' },
      cwd: dir,
      now,
    })
    ids.push(path.basename(r.migrationDir!))
  }
  return ids
}

const tables = (database: Database.Database) =>
  (
    database
      .prepare(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE '%migrations%' AND name NOT LIKE 'sqlite_%' ORDER BY name`,
      )
      .all() as { name: string }[]
  ).map((r) => r.name)

const v = {
  a: `export const a = table('a', { id: serial().primaryKey() })`,
  ab: `export const a = table('a', { id: serial().primaryKey() })\nexport const b = table('b', { id: serial().primaryKey() })`,
  abc: `export const a = table('a', { id: serial().primaryKey() })\nexport const b = table('b', { id: serial().primaryKey() })\nexport const c = table('c', { id: serial().primaryKey() })`,
}

describe('migrating to a named migration', () => {
  it('up --to applies through it; down --to keeps it; rollback --all reverses everything', async () => {
    const folder = path.join(dir, 'migrations')
    const ids = await history(folder, [v.a, v.ab, v.abc])
    const database = new Database(':memory:')
    const opts = {
      adapter: sqliteAdapter({ database }),
      migrationsDir: folder,
      requireReviewed: false,
    }

    expect((await migrateUp({ ...opts, to: 'step_1' })).applied).toEqual(ids.slice(0, 2))
    expect(tables(database)).toEqual(['a', 'b'])
    await migrateLatest(opts)
    expect(tables(database)).toEqual(['a', 'b', 'c'])

    const down = await migrateDown({ ...opts, to: ids[0] })
    expect(down.reversedAll).toEqual([ids[2], ids[1]])
    expect(tables(database)).toEqual(['a'])
    await expect(migrateUp({ ...opts, to: 'nope' })).rejects.toThrow(
      /no pending migration named 'nope'/,
    )

    await migrateLatest(opts)
    const all = await migrateRollback({ ...opts, all: true })
    expect(all.reversed).toEqual([...ids].toReversed())
    expect(tables(database)).toEqual([])
  })
})

describe('a custom migrations table', () => {
  it('records there, and introspection leaves it out', async () => {
    const folder = path.join(dir, 'migrations')
    await history(folder, [v.a])
    const database = new Database(':memory:')
    const adapter = sqliteAdapter({ database, migrationsTable: 'schema_history' })
    await migrateLatest({ adapter, migrationsDir: folder, requireReviewed: false })
    const names = (
      database
        .prepare(
          `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`,
        )
        .all() as {
        name: string
      }[]
    ).map((r) => r.name)
    expect(names).toEqual(['a', 'schema_history', 'schema_history_lock'])
    expect(Object.keys((await adapter.introspect()).tables)).toEqual(['a'])
    // Runs again with the drift check, which would trip on the bookkeeping tables.
    await migrateLatest({ adapter, migrationsDir: folder, requireReviewed: false })
  })
})

describe('several migration folders', () => {
  it('run as one history ordered by id, with drift checked across them', async () => {
    const app = path.join(dir, 'app')
    const pkg = path.join(dir, 'pkg')
    await mkdir(app, { recursive: true })
    const appIds = await history(app, [
      `export const users = table('users', { id: serial().primaryKey() })`,
    ])
    const pkgIds = await history(pkg, [
      `export const audit = table('audit', { id: serial().primaryKey(), note: text() })`,
    ])
    const appIds2 = await history(app, [
      `export const users = table('users', { id: serial().primaryKey(), name: text() })`,
    ])
    const database = new Database(':memory:')
    const opts = {
      adapter: sqliteAdapter({ database }),
      migrationsDir: [app, pkg],
      requireReviewed: false,
    }
    const r = await migrateLatest(opts)
    expect(r.applied).toEqual([appIds[0], pkgIds[0], appIds2[0]])
    expect((await migrateStatus(opts)).map((s) => s.state)).toEqual([
      'applied',
      'applied',
      'applied',
    ])
    // Drift: the live schema matches both folders' snapshots together.
    await migrateLatest(opts)
    // Reversing finds the migration in its own folder.
    await migrateDown(opts)
    const cols = database.prepare('PRAGMA table_info(users)').all() as { name: string }[]
    expect(cols.map((c) => c.name)).toEqual(['id'])
    const db = createDbClient({
      schema: { audit: table('audit', { id: serial().primaryKey(), note: text() }) },
      dialect: sqliteDialect({ database }),
    })
    await db.insertInto('audit').values({ note: 'kept' }).execute()
  })
})

describe('kick.config.ts db block', () => {
  it('carries casing, migrationsTable and migrationsDirs through', () => {
    expect(
      resolveKickDbConfig({ casing: 'snake_case', migrationsTable: 'h', migrationsDirs: ['x'] }),
    ).toMatchObject({ casing: 'snake_case', migrationsTable: 'h', migrationsDirs: ['x'] })
  })
})
