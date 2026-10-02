/**
 * A run killed mid-migration leaves the lock held. The error says how to
 * clear it, and `kick db migrate unlock` (the adapter's `releaseLock`) does.
 */
import { describe, expect, it } from 'vitest'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { MemoryMigrationAdapter, migrateLatest } from '@forinda/kickjs-db'

describe('a stuck migration lock', () => {
  it('names the way out, and releasing it lets migrations run', async () => {
    const migrationsDir = await mkdtemp(path.join(tmpdir(), 'kickdb-lock-'))
    const adapter = new MemoryMigrationAdapter()
    await adapter.acquireLock('killed-deploy') // the run that never released it

    await expect(migrateLatest({ adapter, migrationsDir })).rejects.toThrow(
      /kick db migrate unlock/,
    )

    await adapter.releaseLock()
    await expect(migrateLatest({ adapter, migrationsDir })).resolves.toMatchObject({ applied: [] })
  })
})
