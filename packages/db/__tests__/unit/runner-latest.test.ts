import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { spawnSync } from 'node:child_process'
import { readlinkSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { hostname, tmpdir } from 'node:os'
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

  // The pid space the runner records: the host, plus the pid namespace on Linux.
  const space =
    process.platform === 'linux' ? `${hostname()}:${readlinkSync('/proc/self/ns/pid')}` : hostname()
  const at = '2026-10-29T10:00:00.000Z'
  // A child that has exited: its pid is free.
  const deadPid = () => spawnSync(process.execPath, ['-e', '']).pid!

  it('releases a lock left by a process in this pid space that has exited', async () => {
    await seedMigration(dir, '20260427_010000_a', 'a')
    const adapter = new MemoryMigrationAdapter()
    const dead = deadPid()
    expect(await adapter.acquireLock(`${dead}@${space}@${at}`)).toBe(true)
    const log = { warn: vi.fn() }

    const r = await migrateLatest({ adapter, migrationsDir: dir, log })

    expect(r.applied).toEqual(['20260427_010000_a'])
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining(`${dead}@${space}`))
    expect(await adapter.lockHolder()).toBeNull()
  })

  it.each([
    ['a live process', () => `${process.pid}@${space}@${at}`],
    ['another machine', () => `${deadPid()}@not-${hostname()}@${at}`],
    ['another pid namespace', () => `${deadPid()}@${hostname()}:pid:[1]@${at}`],
    ['a custom owner', () => 'deploy-42'],
    ['a custom owner that looks like a default one', () => `${deadPid()}@${space}@${at}-deploy`],
  ])('keeps a lock held by %s', async (_, makeHolder) => {
    await seedMigration(dir, '20260427_010000_a', 'a')
    const adapter = new MemoryMigrationAdapter()
    const holder = makeHolder()
    expect(await adapter.acquireLock(holder)).toBe(true)
    await expect(migrateLatest({ adapter, migrationsDir: dir })).rejects.toBeInstanceOf(
      MigrationLockError,
    )
    expect(await adapter.lockHolder()).toBe(holder)
  })

  it("keeps even an exited process's lock under lockStaleAfter: 0", async () => {
    await seedMigration(dir, '20260427_010000_a', 'a')
    const adapter = new MemoryMigrationAdapter()
    const holder = `${deadPid()}@${space}@${at}`
    expect(await adapter.acquireLock(holder)).toBe(true)
    await expect(
      migrateLatest({ adapter, migrationsDir: dir, lockStaleAfter: 0 }),
    ).rejects.toBeInstanceOf(MigrationLockError)
    expect(await adapter.lockHolder()).toBe(holder)
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
