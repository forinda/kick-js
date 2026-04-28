import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { migrateLatest, migrateRollback, MemoryMigrationAdapter } from '@forinda/kickjs-db'
import { seedMigration } from '../fixtures/seed-migration'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'kickdb-rollback-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('migrateRollback', () => {
  it('reverses the entire last batch in reverse-applied order', async () => {
    await seedMigration(dir, '20260427_010000_a', 'a')
    await seedMigration(dir, '20260427_020000_b', 'b')
    const adapter = new MemoryMigrationAdapter()
    await migrateLatest({ adapter, migrationsDir: dir, owner: 'test' }) // batch 1: [a, b]

    await seedMigration(dir, '20260427_030000_c', 'c')
    await seedMigration(dir, '20260427_040000_d', 'd')
    await migrateLatest({ adapter, migrationsDir: dir, owner: 'test' }) // batch 2: [c, d]

    const r = await migrateRollback({ adapter, migrationsDir: dir, owner: 'test' })

    expect(r.batch).toBe(2)
    expect(r.reversed).toEqual(['20260427_040000_d', '20260427_030000_c'])

    const remaining = await adapter.listApplied()
    expect(remaining.map((row) => row.id).sort()).toEqual([
      '20260427_010000_a',
      '20260427_020000_b',
    ])
  })

  it('returns empty when nothing applied', async () => {
    const adapter = new MemoryMigrationAdapter()
    const r = await migrateRollback({ adapter, migrationsDir: dir, owner: 'test' })
    expect(r.reversed).toEqual([])
    expect(r.batch).toBeNull()
  })

  it('only reverses the most recent batch — older batches stay applied', async () => {
    await seedMigration(dir, '20260427_010000_a', 'a')
    const adapter = new MemoryMigrationAdapter()
    await migrateLatest({ adapter, migrationsDir: dir, owner: 'test' }) // batch 1

    await seedMigration(dir, '20260427_020000_b', 'b')
    await migrateLatest({ adapter, migrationsDir: dir, owner: 'test' }) // batch 2

    const r = await migrateRollback({ adapter, migrationsDir: dir, owner: 'test' })

    expect(r.batch).toBe(2)
    expect(r.reversed).toEqual(['20260427_020000_b'])
    expect((await adapter.listApplied()).map((row) => row.id)).toEqual(['20260427_010000_a'])
  })
})
