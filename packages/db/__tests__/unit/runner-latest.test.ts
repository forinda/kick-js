import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { migrateLatest, MemoryMigrationAdapter, MigrationLockError } from '@forinda/kickjs-db'
import { seedMigration } from '../fixtures/seed-migration'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'kickdb-runner-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('migrateLatest', () => {
  it('applies all pending migrations in one batch', async () => {
    await seedMigration(dir, '20260427_010000_a', 'a')
    await seedMigration(dir, '20260427_020000_b', 'b')
    const adapter = new MemoryMigrationAdapter()

    const r = await migrateLatest({ adapter, migrationsDir: dir, owner: 'test' })

    expect(r.applied).toEqual(['20260427_010000_a', '20260427_020000_b'])
    expect(r.batch).toBe(1)
    const applied = await adapter.listApplied()
    expect(applied).toHaveLength(2)
    expect(applied.every((row) => row.batch === 1)).toBe(true)
  })

  it('does nothing when there are no pending migrations', async () => {
    const adapter = new MemoryMigrationAdapter()
    const r = await migrateLatest({ adapter, migrationsDir: dir, owner: 'test' })
    expect(r.applied).toEqual([])
    expect(r.batch).toBeNull()
  })

  it('throws MigrationLockError when the lock is already held', async () => {
    const adapter = new MemoryMigrationAdapter()
    expect(await adapter.acquireLock('other')).toBe(true)
    await expect(
      migrateLatest({ adapter, migrationsDir: dir, owner: 'test' }),
    ).rejects.toBeInstanceOf(MigrationLockError)
  })

  it('refuses unreviewed migrations when requireReviewed=true', async () => {
    await seedMigration(dir, '20260427_010000_a', 'a', { reviewed: false })
    const adapter = new MemoryMigrationAdapter()
    await expect(
      migrateLatest({ adapter, migrationsDir: dir, owner: 'test', requireReviewed: true }),
    ).rejects.toThrow(/unreviewed|REVIEWED/i)
  })

  it('starts a new batch on each call', async () => {
    await seedMigration(dir, '20260427_010000_a', 'a')
    const adapter = new MemoryMigrationAdapter()
    await migrateLatest({ adapter, migrationsDir: dir, owner: 'test' })

    await seedMigration(dir, '20260427_020000_b', 'b')
    const r = await migrateLatest({ adapter, migrationsDir: dir, owner: 'test' })

    expect(r.batch).toBe(2)
    const applied = await adapter.listApplied()
    expect(applied.find((row) => row.id === '20260427_010000_a')?.batch).toBe(1)
    expect(applied.find((row) => row.id === '20260427_020000_b')?.batch).toBe(2)
  })

  it('releases lock even on failure (e.g. unreviewed migration)', async () => {
    await seedMigration(dir, '20260427_010000_a', 'a', { reviewed: false })
    const adapter = new MemoryMigrationAdapter()
    await expect(
      migrateLatest({ adapter, migrationsDir: dir, owner: 'test', requireReviewed: true }),
    ).rejects.toThrow()
    // If the lock leaked, this acquire would fail.
    expect(await adapter.acquireLock('next')).toBe(true)
  })
})
