/**
 * `kick db check` — what `migrate latest` would refuse, found without a
 * database: schema changes no migration covers, unreviewed migrations,
 * migrations edited after they were generated.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { appendFile, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { checkMigrations, generate, reviewMigration } from '@forinda/kickjs-db'

const here = path.dirname(fileURLToPath(import.meta.url))
const fixtureSchema = path.resolve(here, '../fixtures/schema.demo.ts')

let dir: string
let config: { schemaPath: string; migrationsDir: string; dialect: 'postgres' }

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'kickdb-check-'))
  config = {
    schemaPath: fixtureSchema,
    migrationsDir: path.join(dir, 'migrations'),
    dialect: 'postgres',
  }
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

const at = (s: number) => () => new Date(Date.UTC(2026, 3, 27, 15, 30, s))

describe('checkMigrations()', () => {
  it('reports a schema no migration covers yet', async () => {
    const r = await checkMigrations({ config, cwd: process.cwd() })
    expect(r).toMatchObject({ ok: false, unmigratedChanges: 2, unreviewed: [], modified: [] })
  })

  it('reports an unreviewed migration, then passes once reviewed', async () => {
    const gen = await generate({ name: 'init', config, cwd: process.cwd(), now: at(1) })
    const id = path.basename(gen.migrationDir!)

    const before = await checkMigrations({ config, cwd: process.cwd() })
    expect(before).toMatchObject({ ok: false, unmigratedChanges: 0, unreviewed: [id] })

    await reviewMigration(config.migrationsDir, id)
    expect(await checkMigrations({ config, cwd: process.cwd() })).toMatchObject({ ok: true })
  })

  it('reports a migration edited after it was generated', async () => {
    const gen = await generate({ name: 'init', config, cwd: process.cwd(), now: at(2) })
    const id = path.basename(gen.migrationDir!)
    await reviewMigration(config.migrationsDir, id)
    await appendFile(path.join(gen.migrationDir!, 'up.sql'), '\n-- tweaked by hand\n')

    expect(await checkMigrations({ config, cwd: process.cwd() })).toMatchObject({
      ok: false,
      modified: [id],
    })
  })

  it('passes with an empty migrations folder when the schema is empty', async () => {
    const empty = path.join(dir, 'empty.schema.ts')
    await writeFile(empty, 'export {}\n')
    const r = await checkMigrations({
      config: { ...config, schemaPath: empty },
      cwd: process.cwd(),
    })
    expect(r.ok).toBe(true)
  })
})
