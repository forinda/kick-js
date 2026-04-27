import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import pg from 'pg'

import { Container } from '@forinda/kickjs'
import { kickDbAdapter } from '@forinda/kickjs-db'
import { pgAdapter } from '@forinda/kickjs-db-pg'
import { seedMigration } from '../../../db/__tests__/fixtures/seed-migration'

let container: StartedPostgreSqlContainer
let pool: pg.Pool

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start()
  pool = new pg.Pool({
    host: container.getHost(),
    port: container.getMappedPort(5432),
    user: container.getUsername(),
    password: container.getPassword(),
    database: container.getDatabase(),
  })
}, 90_000)

afterAll(async () => {
  await pool?.end()
  await container?.stop()
})

let migrationsDir: string

beforeEach(async () => {
  migrationsDir = await mkdtemp(path.join(tmpdir(), 'kickdb-boot-'))
  // Drop everything so each test starts with a clean DB schema.
  await pool.query(`
    DO $$ DECLARE r RECORD;
    BEGIN
      FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public') LOOP
        EXECUTE 'DROP TABLE IF EXISTS "' || r.tablename || '" CASCADE';
      END LOOP;
    END $$;
  `)
})

afterAll(async () => {
  await rm(migrationsDir, { recursive: true, force: true }).catch(() => {})
})

const fakeCtx = (container: Container) => ({
  app: {} as never,
  container,
  env: 'test',
  isProduction: false,
})

describe('kickDbAdapter migrationsOnBoot policies (real PG)', () => {
  it("'fail-if-pending' throws when journal has unapplied entries", async () => {
    await seedMigration(migrationsDir, '20260427_010000_a', 'a')
    const adapter = kickDbAdapter({
      migrationAdapter: pgAdapter({ pool }),
      migrationsDir,
      // default: 'fail-if-pending'
    })
    await expect(adapter.beforeStart!(fakeCtx(Container.create()))).rejects.toThrow(
      /pending migration/,
    )
  }, 60_000)

  it("'apply' runs migrateLatest and brings the schema up", async () => {
    await seedMigration(migrationsDir, '20260427_010000_a', 'a')
    const migrationAdapter = pgAdapter({ pool })
    const adapter = kickDbAdapter({
      migrationAdapter,
      migrationsDir,
      migrationsOnBoot: 'apply',
    })
    await adapter.beforeStart!(fakeCtx(Container.create()))

    // Verify the migration was applied — it inserts a row into kick_migrations.
    const r = await pool.query<{ id: string }>(`SELECT id FROM kick_migrations ORDER BY applied_at`)
    expect(r.rows.map((row) => row.id)).toEqual(['20260427_010000_a'])
  }, 60_000)

  it("'ignore' boots cleanly even with pending migrations", async () => {
    await seedMigration(migrationsDir, '20260427_010000_a', 'a')
    const migrationAdapter = pgAdapter({ pool })
    const adapter = kickDbAdapter({
      migrationAdapter,
      migrationsDir,
      migrationsOnBoot: 'ignore',
    })
    await expect(adapter.beforeStart!(fakeCtx(Container.create()))).resolves.toBeUndefined()
    // Nothing applied.
    const r = await pool.query(`SELECT count(*)::int AS c FROM kick_migrations WHERE id = $1`, [
      '20260427_010000_a',
    ])
    expect(r.rows[0].c).toBe(0)
  }, 60_000)

  it('passes through when no pending migrations exist', async () => {
    const migrationAdapter = pgAdapter({ pool })
    const adapter = kickDbAdapter({ migrationAdapter, migrationsDir })
    await expect(adapter.beforeStart!(fakeCtx(Container.create()))).resolves.toBeUndefined()
  }, 60_000)
})
