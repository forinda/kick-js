import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { migrateLatest, migrateUp, MemoryMigrationAdapter } from '@forinda/kickjs-db'
import { seedMigration } from '../fixtures/seed-migration'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'kickdb-up-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('migrateUp', () => {
  it('applies only the next pending', async () => {
    await seedMigration(dir, '20260427_010000_a', 'a')
    await seedMigration(dir, '20260427_020000_b', 'b')
    const adapter = new MemoryMigrationAdapter()

    const r = await migrateUp({ adapter, migrationsDir: dir, owner: 'test' })

    expect(r.applied).toEqual(['20260427_010000_a'])
    expect(r.batch).toBe(1)
    expect((await adapter.listApplied()).map((row) => row.id)).toEqual(['20260427_010000_a'])
  })

  it('returns empty when no pending', async () => {
    const adapter = new MemoryMigrationAdapter()
    const r = await migrateUp({ adapter, migrationsDir: dir, owner: 'test' })
    expect(r.applied).toEqual([])
    expect(r.batch).toBeNull()
  })

  it('migrateUp + migrateLatest interleave: each gets its own batch', async () => {
    await seedMigration(dir, '20260427_010000_a', 'a')
    await seedMigration(dir, '20260427_020000_b', 'b')
    await seedMigration(dir, '20260427_030000_c', 'c')
    const adapter = new MemoryMigrationAdapter()

    await migrateUp({ adapter, migrationsDir: dir, owner: 'test' }) // batch 1, applies a
    await migrateLatest({ adapter, migrationsDir: dir, owner: 'test' }) // batch 2, applies b + c

    const applied = await adapter.listApplied()
    expect(applied.find((r) => r.id === '20260427_010000_a')?.batch).toBe(1)
    expect(applied.find((r) => r.id === '20260427_020000_b')?.batch).toBe(2)
    expect(applied.find((r) => r.id === '20260427_030000_c')?.batch).toBe(2)
  })
})
