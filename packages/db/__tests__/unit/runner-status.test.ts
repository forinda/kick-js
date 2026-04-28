import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { migrateLatest, migrateStatus, MemoryMigrationAdapter } from '@forinda/kickjs-db'
import { seedMigration } from '../fixtures/seed-migration'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'kickdb-status-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('migrateStatus', () => {
  it('reports applied + pending with batch numbers', async () => {
    await seedMigration(dir, '20260427_010000_a', 'a')
    await seedMigration(dir, '20260427_020000_b', 'b')
    const adapter = new MemoryMigrationAdapter()
    await migrateLatest({ adapter, migrationsDir: dir, owner: 'test' })

    await seedMigration(dir, '20260427_030000_c', 'c')

    const status = await migrateStatus({ adapter, migrationsDir: dir })
    expect(
      status.map((s) => ({ id: s.id, state: s.state, batch: s.batch, reviewed: s.reviewed })),
    ).toEqual([
      { id: '20260427_010000_a', state: 'applied', batch: 1, reviewed: true },
      { id: '20260427_020000_b', state: 'applied', batch: 1, reviewed: true },
      { id: '20260427_030000_c', state: 'pending', batch: null, reviewed: true },
    ])
  })

  it('reports an empty array when journal is empty', async () => {
    const adapter = new MemoryMigrationAdapter()
    expect(await migrateStatus({ adapter, migrationsDir: dir })).toEqual([])
  })

  it('flags reviewed=false from meta.json', async () => {
    await seedMigration(dir, '20260427_010000_a', 'a', { reviewed: false })
    const adapter = new MemoryMigrationAdapter()
    const status = await migrateStatus({ adapter, migrationsDir: dir })
    expect(status[0].reviewed).toBe(false)
  })
})
