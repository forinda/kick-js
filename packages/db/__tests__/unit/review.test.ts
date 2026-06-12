/**
 * `reviewMigration` — banner-era migrations flip meta.json ONLY (SQL
 * untouched, journal hash stays valid by construction); legacy
 * migrations with `-- REVIEWED: false` markers inside the hashed files
 * get the old swap-and-rehash treatment.
 */
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, it, expect, beforeEach, afterEach } from 'vitest'

import { generate, computeMigrationHash, verifyMigrationHash } from '@forinda/kickjs-db'
import { reviewMigration } from '../../src/migrate/review'
import type { Journal } from '../../src/migrate/journal'

const here = path.dirname(fileURLToPath(import.meta.url))
const fixtureSchema = path.resolve(here, '../fixtures/schema.demo.ts')

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'kickdb-review-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

async function readJournal(migrationsDir: string): Promise<Journal> {
  return JSON.parse(await readFile(path.join(migrationsDir, '_journal.json'), 'utf8'))
}

describe('reviewMigration — banner-era migrations', () => {
  it('flips meta only; SQL and journal hash are untouched', async () => {
    const cfg = {
      schemaPath: fixtureSchema,
      migrationsDir: path.join(dir, 'migrations'),
      dialect: 'postgres' as const,
    }
    const fixed = new Date(Date.UTC(2026, 5, 12, 8, 0, 0))
    await generate({ name: 'init', config: cfg, cwd: process.cwd(), now: () => fixed })
    const id = '20260612_080000_init'
    const migDir = path.join(cfg.migrationsDir, id)

    const sqlBefore = await readFile(path.join(migDir, 'up.sql'), 'utf8')
    const hashBefore = (await readJournal(cfg.migrationsDir)).entries[0].hash

    const r = await reviewMigration(cfg.migrationsDir, id)
    expect(r.alreadyReviewed).toBe(false)

    const meta = JSON.parse(await readFile(path.join(migDir, 'meta.json'), 'utf8'))
    expect(meta.reviewed).toBe(true)
    // SQL bytes identical → stored hash still verifies, no rewrite needed.
    expect(await readFile(path.join(migDir, 'up.sql'), 'utf8')).toBe(sqlBefore)
    expect((await readJournal(cfg.migrationsDir)).entries[0].hash).toBe(hashBefore)
    expect(await verifyMigrationHash(migDir, hashBefore)).toBe(true)
  })

  it('is idempotent', async () => {
    const cfg = {
      schemaPath: fixtureSchema,
      migrationsDir: path.join(dir, 'migrations'),
      dialect: 'postgres' as const,
    }
    const fixed = new Date(Date.UTC(2026, 5, 12, 8, 0, 0))
    await generate({ name: 'init', config: cfg, cwd: process.cwd(), now: () => fixed })
    const id = '20260612_080000_init'
    await reviewMigration(cfg.migrationsDir, id)
    expect((await reviewMigration(cfg.migrationsDir, id)).alreadyReviewed).toBe(true)
  })
})

describe('reviewMigration — legacy marker migrations', () => {
  it('swaps the markers and rewrites the journal hash', async () => {
    const migrationsDir = path.join(dir, 'migrations')
    const id = '20250101_000000_legacy'
    const migDir = path.join(migrationsDir, id)
    await mkdir(migDir, { recursive: true })
    await writeFile(path.join(migDir, 'up.sql'), '-- REVIEWED: false\nCREATE TABLE "t" ();\n')
    await writeFile(path.join(migDir, 'down.sql'), '-- REVIEWED: false\nDROP TABLE "t";\n')
    await writeFile(path.join(migDir, 'snapshot.json'), '{}\n')
    await writeFile(path.join(migDir, 'meta.json'), JSON.stringify({ id, reviewed: false }) + '\n')
    const hash = await computeMigrationHash(migDir)
    await writeFile(
      path.join(migrationsDir, '_journal.json'),
      JSON.stringify({
        version: 1,
        dialect: 'postgres',
        entries: [{ id, tag: 'legacy', hash, createdAt: '2025-01-01T00:00:00Z' }],
      }) + '\n',
    )

    await reviewMigration(migrationsDir, id)

    const upSql = await readFile(path.join(migDir, 'up.sql'), 'utf8')
    expect(upSql).toContain('-- REVIEWED: true')
    const newHash = (await readJournal(migrationsDir)).entries[0].hash
    expect(newHash).not.toBe(hash)
    expect(await verifyMigrationHash(migDir, newHash)).toBe(true)
  })
})
