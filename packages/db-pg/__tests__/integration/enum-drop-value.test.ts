/**
 * Real-PG round trip for the M3.B `pgEnum` value-removal flow
 * (M4.E.1 from `docs/db/m4-plan.md`). Exercises the full lifecycle:
 *
 *   1. Schema with referenced enum + seeded rows.
 *   2. Migration that removes a value via `kick db generate`.
 *   3. Apply without `--confirm-enum-drop` → `MigrationEnumDropError`,
 *      schema unchanged.
 *   4. Apply with `--confirm-enum-drop` while rows hold the removed
 *      value → cast fails inside the transaction, transaction rolls
 *      back, schema still unchanged.
 *   5. Update the dead-value rows, retry → succeeds, enum reflects
 *      the new value list, kick_migrations records the apply.
 *
 * Drives the runner via the public `migrateLatest()` API rather than
 * the CLI `kick db migrate latest` so we stay scoped to a single
 * package and don't shell out. The CLI's `confirmEnumDrop` flag
 * threads through `RunnerOptions.confirmEnumDrop` — same value
 * surfaces through both paths.
 *
 * Skipped when DOCKER_AVAILABLE is unset and the bootstrap container
 * fails — the test suite stays runnable without Docker on dev
 * machines, and CI provisions Docker.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import pg from 'pg'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import {
  MigrationEnumDropError,
  appendJournalEntry,
  computeMigrationHash,
  migrateLatest,
} from '@forinda/kickjs-db'
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
}, 90_000)

afterAll(async () => {
  await pool?.end()
  await container?.stop()
})

let migrationsDir: string

beforeEach(async () => {
  // Clean catalog state — every test starts from a blank schema so
  // the assertions about `pg_enum.enumlabel` are unambiguous.
  await pool.query(`
    DROP TABLE IF EXISTS "users" CASCADE;
    DROP TABLE IF EXISTS "kick_migrations", "kick_migrations_lock" CASCADE;
    DROP TYPE IF EXISTS "status" CASCADE;
    DROP TYPE IF EXISTS "status__old" CASCADE;
  `)

  // Each test owns its own migrations dir — appending to a shared one
  // would carry hashes across cases.
  migrationsDir = await mkdtemp(path.join(tmpdir(), 'kickdb-m4e1-'))
})

afterAll(async () => {
  if (migrationsDir) await rm(migrationsDir, { recursive: true, force: true })
})

describe('M4.E.1 — pgEnum value removal full lifecycle', () => {
  it('refuses to apply without confirmEnumDrop, leaves DB untouched, then succeeds with the flag', async () => {
    // ── 1. Plant the prior schema state directly on the DB ────────────
    // Note: no DEFAULT on the column. The M3.B rename-recreate dance
    // doesn't restore column defaults across the type swap — a DEFAULT
    // referencing the old enum trips PG's "default for column X
    // cannot be cast automatically" error before any row evaluation
    // runs, which is a separate gap from the dead-value rollback this
    // test exercises.
    await pool.query(`
      CREATE TYPE "status" AS ENUM ('active', 'banned', 'legacy');
      CREATE TABLE "users" (
        "id" serial PRIMARY KEY,
        "status" "status" NOT NULL
      );
      INSERT INTO "users" ("status") VALUES ('active'), ('banned');
    `)

    // ── 2. Plant a migration that removes the `legacy` value ──────────
    await plantEnumDropMigration({
      id: '20260101_000001_drop_legacy',
      migrationsDir,
    })

    const adapter = pgAdapter({ pool })
    try {
      // ── 3. Without --confirm-enum-drop → error, no apply ───────────
      let firstAttemptError: unknown = null
      try {
        await migrateLatest({ adapter, migrationsDir })
      } catch (err) {
        firstAttemptError = err
      }
      expect(firstAttemptError).toBeInstanceOf(MigrationEnumDropError)

      const stillThere = await pool.query<{ enumlabel: string }>(
        `SELECT enumlabel FROM pg_enum
         WHERE enumtypid = (SELECT oid FROM pg_type WHERE typname = 'status')
         ORDER BY enumsortorder`,
      )
      expect(stillThere.rows.map((r) => r.enumlabel)).toEqual(['active', 'banned', 'legacy'])

      // No row recorded for the failed attempt.
      const appliedAfterRefusal = await pool.query(`SELECT id FROM kick_migrations`)
      expect(appliedAfterRefusal.rowCount ?? 0).toBe(0)

      // ── 4. Now stage a row holding the dead value ──────────────────
      await pool.query(`INSERT INTO "users" ("status") VALUES ('legacy')`)

      // ── 5. With --confirm-enum-drop but dead row present → cast
      //      fails inside the rename-recreate transaction, rolls back ─
      let secondAttemptError: unknown = null
      try {
        await migrateLatest({ adapter, migrationsDir, confirmEnumDrop: true })
      } catch (err) {
        secondAttemptError = err
      }
      expect(secondAttemptError).toBeInstanceOf(Error)
      expect(String((secondAttemptError as Error).message)).toMatch(/legacy|invalid input/i)

      // After rollback the enum still has every value AND the dead
      // row is still there.
      const afterRollback = await pool.query<{ enumlabel: string }>(
        `SELECT enumlabel FROM pg_enum
         WHERE enumtypid = (SELECT oid FROM pg_type WHERE typname = 'status')
         ORDER BY enumsortorder`,
      )
      expect(afterRollback.rows.map((r) => r.enumlabel)).toEqual(['active', 'banned', 'legacy'])

      const deadCount = await pool.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM "users" WHERE "status"::text = 'legacy'`,
      )
      expect(deadCount.rows[0]?.count).toBe('1')

      // The runner records nothing on the rolled-back attempt.
      const appliedAfterRollback = await pool.query(`SELECT id FROM kick_migrations`)
      expect(appliedAfterRollback.rowCount ?? 0).toBe(0)

      // ── 6. Coerce the dead row off the value, retry → succeeds ─────
      await pool.query(`UPDATE "users" SET "status" = 'banned' WHERE "status" = 'legacy'`)

      const result = await migrateLatest({ adapter, migrationsDir, confirmEnumDrop: true })
      expect(result.applied).toEqual(['20260101_000001_drop_legacy'])

      // Enum now matches the post-removal value list.
      const finalLabels = await pool.query<{ enumlabel: string }>(
        `SELECT enumlabel FROM pg_enum
         WHERE enumtypid = (SELECT oid FROM pg_type WHERE typname = 'status')
         ORDER BY enumsortorder`,
      )
      expect(finalLabels.rows.map((r) => r.enumlabel)).toEqual(['active', 'banned'])

      // The rename-recreate dropped the `__old` shadow.
      const oldType = await pool.query(`SELECT 1 FROM pg_type WHERE typname = 'status__old'`)
      expect(oldType.rowCount ?? 0).toBe(0)

      // Migration recorded in kick_migrations.
      const finalApplied = await pool.query<{ id: string }>(`SELECT id FROM kick_migrations`)
      expect(finalApplied.rows.map((r) => r.id)).toEqual(['20260101_000001_drop_legacy'])
    } finally {
      await adapter.close()
    }
  }, 60_000)
})

/**
 * Writes one rename-recreate migration with the `-- KICK ENUM REMOVE`
 * header pre-baked. Bypasses the `kick db generate` pipeline because
 * we don't want to hand the integration test a TS schema module to
 * load — we already know what SQL it would emit and the goal is to
 * exercise the runner's gate + the rename-recreate dance, not the
 * generator.
 */
async function plantEnumDropMigration(opts: { id: string; migrationsDir: string }): Promise<void> {
  const dir = path.join(opts.migrationsDir, opts.id)
  await mkdir(dir, { recursive: true })

  const upSql = [
    '-- REVIEWED: true',
    '-- KICK ENUM REMOVE',
    '-- enum: status',
    '-- removed: legacy',
    '-- columns: users.status',
    '--',
    '-- This migration drops values from a PostgreSQL ENUM type. The',
    '-- runner refuses to apply it without the --confirm-enum-drop flag.',
    'ALTER TYPE "status" RENAME TO "status__old";',
    `CREATE TYPE "status" AS ENUM ('active', 'banned');`,
    'ALTER TABLE "users"',
    '  ALTER COLUMN "status" TYPE "status"',
    '  USING "status"::text::"status";',
    'DROP TYPE "status__old";',
    '',
  ].join('\n')

  const downSql = [
    '-- REVIEWED: true',
    '-- DRAFT: ambiguous reverses present (drop column / drop table / type change). Audit before applying.',
    '',
  ].join('\n')

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
      name: 'drop_legacy',
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
    tag: 'drop_legacy',
    hash,
    createdAt: '2026-01-01T00:00:01.000Z',
  })
}
