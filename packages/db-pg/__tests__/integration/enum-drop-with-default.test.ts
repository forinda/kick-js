/**
 * M5.A.1 — full lifecycle of a `pgEnum` value removal where the
 * affected column carries a DEFAULT. Extends M4.E.1
 * (enum-drop-value.test.ts) with the DEFAULT preservation path so
 * adopters whose schemas declare `column.notNull().default('foo')`
 * can run the rename-recreate dance without manual SQL editing.
 *
 * Spec: docs/db/spec-default-preservation.md.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import pg from 'pg'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { appendJournalEntry, computeMigrationHash, migrateLatest } from '@forinda/kickjs-db'
import { pgAdapter } from '@forinda/kickjs-db-pg'

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
  // Idle pg clients receive FATAL 57P01 when the container stops mid-teardown;
  // an unlistened 'error' event becomes a process-level uncaught exception that
  // fails the run AFTER every test passed. Expected teardown noise — swallow.
  pool.on('error', () => {})
}, 90_000)

afterAll(async () => {
  await pool?.end()
  await container?.stop()
})

let migrationsDir: string

beforeEach(async () => {
  await pool.query(`
    DROP TABLE IF EXISTS "users" CASCADE;
    DROP TABLE IF EXISTS "kick_migrations", "kick_migrations_lock" CASCADE;
    DROP TYPE IF EXISTS "status" CASCADE;
    DROP TYPE IF EXISTS "status__old" CASCADE;
  `)
  migrationsDir = await mkdtemp(path.join(tmpdir(), 'kickdb-m5a1-'))
})

afterAll(async () => {
  if (migrationsDir) await rm(migrationsDir, { recursive: true, force: true })
})

describe('M5.A.1 — pgEnum value removal preserves column DEFAULT', () => {
  it('drops/restores DEFAULT around the type swap; new INSERTs pick up the surviving default', async () => {
    // Schema with a DEFAULT pointing at a value that survives the
    // removal. Without M5.A.1 this fixture used to trip PG with
    // "default for column status cannot be cast automatically".
    await pool.query(`
      CREATE TYPE "status" AS ENUM ('active', 'banned', 'legacy');
      CREATE TABLE "users" (
        "id" serial PRIMARY KEY,
        "status" "status" NOT NULL DEFAULT 'active'
      );
      INSERT INTO "users" ("status") VALUES ('active'), ('banned');
    `)

    await plantEnumDropMigrationWithDefaults({
      id: '20260101_000001_drop_legacy',
      migrationsDir,
    })

    const adapter = pgAdapter({ pool })
    try {
      const result = await migrateLatest({ adapter, migrationsDir, confirmEnumDrop: true })
      expect(result.applied).toEqual(['20260101_000001_drop_legacy'])

      // Enum reflects the new value list.
      const labels = await pool.query<{ enumlabel: string }>(
        `SELECT enumlabel FROM pg_enum
         WHERE enumtypid = (SELECT oid FROM pg_type WHERE typname = 'status')
         ORDER BY enumsortorder`,
      )
      expect(labels.rows.map((r) => r.enumlabel)).toEqual(['active', 'banned'])

      // The DEFAULT survived through the type swap and now points
      // at the freshly-created enum.
      const defaultRow = await pool.query<{ column_default: string }>(`
        SELECT column_default FROM information_schema.columns
        WHERE table_name = 'users' AND column_name = 'status'
      `)
      expect(defaultRow.rows[0]?.column_default).toMatch(/'active'::status/)

      // INSERT a new row without specifying status — picks up the
      // restored default.
      await pool.query(`INSERT INTO "users" DEFAULT VALUES`)
      const newRow = await pool.query<{ status: string }>(
        `SELECT status FROM "users" ORDER BY id DESC LIMIT 1`,
      )
      expect(newRow.rows[0]?.status).toBe('active')

      // Pre-existing rows untouched.
      const existing = await pool.query<{ status: string; cnt: string }>(
        `SELECT status, count(*)::text AS cnt FROM "users" WHERE id <= 2 GROUP BY status ORDER BY status`,
      )
      expect(existing.rows.map((r) => `${r.status}=${r.cnt}`)).toEqual(['active=1', 'banned=1'])

      // Shadow type dropped.
      const shadow = await pool.query(`SELECT 1 FROM pg_type WHERE typname = 'status__old'`)
      expect(shadow.rowCount ?? 0).toBe(0)
    } finally {
      await adapter.close()
    }
  }, 60_000)
})

/**
 * Writes the rename-recreate migration with the M5.A.1 DROP/SET
 * DEFAULT brackets pre-baked. Bypasses `kick db generate` for the
 * same reason as M4.E.1 — the goal is to exercise the runner + the
 * dance, not the generator pipeline.
 */
async function plantEnumDropMigrationWithDefaults(opts: {
  id: string
  migrationsDir: string
}): Promise<void> {
  const dir = path.join(opts.migrationsDir, opts.id)
  await mkdir(dir, { recursive: true })

  const upSql = [
    '-- REVIEWED: true',
    '-- KICK ENUM REMOVE',
    '-- enum: status',
    '-- removed: legacy',
    '-- columns: users.status',
    '--',
    '-- This migration drops values from a PostgreSQL ENUM type.',
    'ALTER TYPE "status" RENAME TO "status__old";',
    `CREATE TYPE "status" AS ENUM ('active', 'banned');`,
    'ALTER TABLE "users" ALTER COLUMN "status" DROP DEFAULT;',
    'ALTER TABLE "users"',
    '  ALTER COLUMN "status" TYPE "status"',
    '  USING "status"::text::"status";',
    `ALTER TABLE "users" ALTER COLUMN "status" SET DEFAULT 'active'::"status";`,
    'DROP TYPE "status__old";',
    '',
  ].join('\n')

  const downSql = ['-- REVIEWED: true', '-- DRAFT: ambiguous reverses present.', ''].join('\n')

  await writeFile(path.join(dir, 'up.sql'), upSql, 'utf8')
  await writeFile(path.join(dir, 'down.sql'), downSql, 'utf8')
  await writeFile(
    path.join(dir, 'snapshot.json'),
    JSON.stringify({ version: 1, dialect: 'postgres', tables: {} }),
    'utf8',
  )
  await writeFile(
    path.join(dir, 'meta.json'),
    JSON.stringify({
      id: opts.id,
      name: 'drop_legacy_default',
      reviewed: true,
      dialect: 'postgres',
      previousId: null,
      downIsDraft: true,
    }),
    'utf8',
  )

  const hash = await computeMigrationHash(dir)
  await appendJournalEntry(opts.migrationsDir, 'postgres', {
    id: opts.id,
    tag: 'drop_legacy_default',
    hash,
    createdAt: '2026-01-01T00:00:01.000Z',
  })
}
