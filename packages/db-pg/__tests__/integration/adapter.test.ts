import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import pg from 'pg'

import type { MigrationAdapter } from '@forinda/kickjs-db'
import { pgAdapter } from '@forinda/kickjs-db-pg'

let container: StartedPostgreSqlContainer
let pool: pg.Pool
let adapter: MigrationAdapter

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start()
  pool = new pg.Pool({
    host: container.getHost(),
    port: container.getMappedPort(5432),
    user: container.getUsername(),
    password: container.getPassword(),
    database: container.getDatabase(),
  })
  // Idle pg clients receive FATAL 57P01 when the container stops mid-teardown;
  // an unlistened 'error' event becomes a process-level uncaught exception that
  // fails the run AFTER every test passed. Expected teardown noise — swallow.
  pool.on('error', () => {})
  adapter = pgAdapter({ pool })
}, 90_000)

afterAll(async () => {
  await adapter?.close()
  await pool?.end()
  await container?.stop()
})

beforeEach(async () => {
  await pool.query('DROP TABLE IF EXISTS "kick_migrations", "kick_migrations_lock" CASCADE')
})

describe('pgAdapter() — MigrationAdapter contract', () => {
  it('ensureMigrationTables creates idempotent tables', async () => {
    await adapter.ensureMigrationTables()
    await adapter.ensureMigrationTables() // second call must not error
    const r = await pool.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_name IN ('kick_migrations', 'kick_migrations_lock')
      ORDER BY table_name
    `)
    expect(r.rows.map((x) => x.table_name)).toEqual(['kick_migrations', 'kick_migrations_lock'])
  })

  it('listApplied / recordApplied / removeApplied round-trip', async () => {
    await adapter.ensureMigrationTables()
    expect(await adapter.listApplied()).toEqual([])

    await adapter.recordApplied({
      id: '20260427_010000_a',
      name: 'a',
      hash: 'sha256:abc',
      batch: 1,
      direction: 'up',
    })
    const applied = await adapter.listApplied()
    expect(applied).toHaveLength(1)
    expect(applied[0]).toMatchObject({
      id: '20260427_010000_a',
      name: 'a',
      batch: 1,
      direction: 'up',
    })
    expect(typeof applied[0].appliedAt).toBe('string')

    await adapter.removeApplied('20260427_010000_a')
    expect(await adapter.listApplied()).toEqual([])
  })

  it('acquireLock is exclusive — second caller gets false until releaseLock', async () => {
    await adapter.ensureMigrationTables()
    expect(await adapter.acquireLock('p1')).toBe(true)
    expect(await adapter.acquireLock('p2')).toBe(false)
    await adapter.releaseLock()
    expect(await adapter.acquireLock('p3')).toBe(true)
    await adapter.releaseLock()
  })

  it('applySqlInTx commits on success', async () => {
    await adapter.ensureMigrationTables()
    await adapter.applySqlInTx(`CREATE TABLE "tx_test" ("id" integer);`)
    const r = await pool.query(`SELECT to_regclass('public.tx_test') AS t`)
    expect(r.rows[0].t).toBe('tx_test')
    await pool.query(`DROP TABLE "tx_test"`)
  })

  it('applySqlInTx rolls back on error — partial DDL is undone', async () => {
    await adapter.ensureMigrationTables()
    await expect(
      adapter.applySqlInTx(`
        CREATE TABLE "rollback_test" ("id" integer);
        SELECT 1 FROM "no_such_table";
      `),
    ).rejects.toThrow()
    const r = await pool.query(`SELECT to_regclass('public.rollback_test') AS t`)
    expect(r.rows[0].t).toBe(null)
  })

  it('applySqlNoTx commits each statement independently', async () => {
    await adapter.ensureMigrationTables()
    await adapter.applySqlNoTx(`CREATE TABLE "no_tx_test" ("id" integer);`)
    const r = await pool.query(`SELECT to_regclass('public.no_tx_test') AS t`)
    expect(r.rows[0].t).toBe('no_tx_test')
    await pool.query(`DROP TABLE "no_tx_test"`)
  })

  it('introspect returns a SchemaSnapshot for the live DB', async () => {
    await adapter.ensureMigrationTables()
    await pool.query(`CREATE TABLE "intro_test" ("id" serial PRIMARY KEY, "name" varchar(50))`)
    const snap = await adapter.introspect()
    expect(snap.tables.intro_test).toBeDefined()
    // kick_migrations is excluded.
    expect(snap.tables.kick_migrations).toBeUndefined()
    await pool.query(`DROP TABLE "intro_test"`)
  })

  it('rejects unsafe schema names at construction', () => {
    expect(() => pgAdapter({ pool, schema: 'evil; DROP TABLE users' })).toThrow(
      /Invalid PG schema name/,
    )
  })
})
