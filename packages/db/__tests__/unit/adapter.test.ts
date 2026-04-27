import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { Container, createToken } from '@forinda/kickjs'
import { kickDbAdapter, MemoryMigrationAdapter } from '@forinda/kickjs-db'
import type { MigrationAdapter } from '@forinda/kickjs-db'
import { seedMigration } from '../fixtures/seed-migration'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'kickdb-adapter-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

const fakeCtx = (container: Container) => ({
  app: {} as any,
  container,
  env: 'test',
  isProduction: false,
})

describe('kickDbAdapter()', () => {
  it("'fail-if-pending' (default) throws when journal has unapplied entries", async () => {
    await seedMigration(dir, '20260427_010000_a', 'a')
    const migrationAdapter = new MemoryMigrationAdapter()
    const container = Container.create()
    const adapter = kickDbAdapter({ migrationAdapter, migrationsDir: dir })

    await expect(adapter.beforeStart!(fakeCtx(container))).rejects.toThrow(/pending migration/)
  })

  it("'apply' runs migrateLatest automatically", async () => {
    await seedMigration(dir, '20260427_010000_a', 'a')
    const migrationAdapter = new MemoryMigrationAdapter()
    const container = Container.create()
    const adapter = kickDbAdapter({
      migrationAdapter,
      migrationsDir: dir,
      migrationsOnBoot: 'apply',
    })

    await adapter.beforeStart!(fakeCtx(container))
    expect((await migrationAdapter.listApplied()).map((r) => r.id)).toEqual(['20260427_010000_a'])
  })

  it("'ignore' boots cleanly even with pending migrations", async () => {
    await seedMigration(dir, '20260427_010000_a', 'a')
    const migrationAdapter = new MemoryMigrationAdapter()
    const container = Container.create()
    const adapter = kickDbAdapter({
      migrationAdapter,
      migrationsDir: dir,
      migrationsOnBoot: 'ignore',
    })

    await expect(adapter.beforeStart!(fakeCtx(container))).resolves.toBeUndefined()
    expect(await migrationAdapter.listApplied()).toEqual([])
  })

  it('passes through when no pending migrations', async () => {
    const migrationAdapter = new MemoryMigrationAdapter()
    const container = Container.create()
    const adapter = kickDbAdapter({ migrationAdapter, migrationsDir: dir })

    await expect(adapter.beforeStart!(fakeCtx(container))).resolves.toBeUndefined()
  })

  it('registers migrationAdapter under provided token', async () => {
    const TOKEN = createToken<MigrationAdapter>('app/db/test')
    const migrationAdapter = new MemoryMigrationAdapter()
    const container = Container.create()
    const adapter = kickDbAdapter({ migrationAdapter, migrationsDir: dir, token: TOKEN })

    await adapter.beforeStart!(fakeCtx(container))
    expect(container.resolve(TOKEN)).toBe(migrationAdapter)
  })

  it('shutdown calls migrationAdapter.close()', async () => {
    const migrationAdapter = new MemoryMigrationAdapter()
    let closed = false
    migrationAdapter.close = async () => {
      closed = true
    }
    const adapter = kickDbAdapter({ migrationAdapter, migrationsDir: dir })
    await adapter.shutdown!()
    expect(closed).toBe(true)
  })
})
