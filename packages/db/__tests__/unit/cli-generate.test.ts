import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, readFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { generate } from '@forinda/kickjs-db'

const here = path.dirname(fileURLToPath(import.meta.url))
const fixtureSchema = path.resolve(here, '../fixtures/schema.demo.ts')

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'kickdb-gen-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('generate()', () => {
  it('creates a migration on first run', async () => {
    const cfg = {
      schemaPath: fixtureSchema,
      migrationsDir: path.join(dir, 'migrations'),
      dialect: 'postgres' as const,
    }
    const fixed = new Date(Date.UTC(2026, 3, 27, 15, 30, 12))
    const r = await generate({ name: 'init', config: cfg, cwd: process.cwd(), now: () => fixed })

    expect(r.status).toBe('created')
    expect(r.changeCount).toBe(2) // createTable + addIndex(unique)

    const subdirs = await readdir(cfg.migrationsDir)
    expect(subdirs).toEqual(['20260427_153012_init'])

    const upSql = await readFile(path.join(cfg.migrationsDir, subdirs[0], 'up.sql'), 'utf8')
    expect(upSql.startsWith('-- REVIEWED: false\n')).toBe(true)
    expect(upSql).toContain('CREATE TABLE "users"')
    expect(upSql).toContain('CREATE UNIQUE INDEX "users_email_unique"')

    const downSql = await readFile(path.join(cfg.migrationsDir, subdirs[0], 'down.sql'), 'utf8')
    expect(downSql.startsWith('-- REVIEWED: false\n')).toBe(true)
    // Forward only adds — per spec §5, the reverse is clean (no DRAFT marker).
    expect(downSql).not.toContain('-- DRAFT')
    expect(downSql).toContain('DROP TABLE "users"')
    expect(downSql).toContain('DROP INDEX "users_email_unique"')
    // Order: drop index before drop table.
    expect(downSql.indexOf('DROP INDEX')).toBeLessThan(downSql.indexOf('DROP TABLE'))

    const meta = JSON.parse(
      await readFile(path.join(cfg.migrationsDir, subdirs[0], 'meta.json'), 'utf8'),
    )
    expect(meta).toMatchObject({
      id: '20260427_153012_init',
      reviewed: false,
      dialect: 'postgres',
      previousId: null,
      downIsDraft: false,
    })
  })

  it('returns no-changes when re-run against the same schema', async () => {
    const cfg = {
      schemaPath: fixtureSchema,
      migrationsDir: path.join(dir, 'migrations'),
      dialect: 'postgres' as const,
    }
    const t1 = new Date(Date.UTC(2026, 3, 27, 15, 30, 12))
    const t2 = new Date(Date.UTC(2026, 3, 27, 16, 0, 0))

    await generate({ name: 'init', config: cfg, cwd: process.cwd(), now: () => t1 })
    const r2 = await generate({ name: 'init2', config: cfg, cwd: process.cwd(), now: () => t2 })

    expect(r2.status).toBe('no-changes')
    expect(r2.changeCount).toBe(0)
  })
})
