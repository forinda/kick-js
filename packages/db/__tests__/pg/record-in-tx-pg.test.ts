/**
 * Postgres: a migration and its kick_migrations row commit together — if
 * recording fails, the migration's DDL rolls back with it.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import pg from 'pg'
import { appendJournalEntry, computeMigrationHash, migrateLatest } from '@forinda/kickjs-db'
import { pgAdapter } from '@forinda/kickjs-db/pg'

let container: StartedPostgreSqlContainer
let pool: pg.Pool

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start()
  pool = new pg.Pool({ connectionString: container.getConnectionUri() })
  pool.on('error', () => {})
}, 120_000)

afterAll(async () => {
  await pool?.end()
  await container?.stop()
})

describe('a migration and its record commit together (Postgres)', () => {
  it('rolls the migration back when recording it fails', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'kickdb-rec-pg-'))
    const id = '20260101_000000_x'
    const out = path.join(dir, id)
    await mkdir(out, { recursive: true })
    await writeFile(
      path.join(out, 'up.sql'),
      'CREATE TABLE widgets (id int); DROP TABLE kick_migrations;',
    )
    await writeFile(path.join(out, 'down.sql'), '')
    await writeFile(
      path.join(out, 'snapshot.json'),
      JSON.stringify({ version: 1, dialect: 'postgres', tables: {} }),
    )
    await writeFile(
      path.join(out, 'meta.json'),
      JSON.stringify({
        id,
        name: id,
        reviewed: true,
        dialect: 'postgres',
        previousId: null,
        downIsDraft: false,
      }),
    )
    await appendJournalEntry(dir, 'postgres', {
      id,
      tag: id,
      hash: await computeMigrationHash(out),
      createdAt: new Date().toISOString(),
    })

    const adapter = pgAdapter({ pool })
    await expect(
      migrateLatest({ adapter, migrationsDir: dir, driftCheck: 'ignore' }),
    ).rejects.toThrow()

    const { rows } = await pool.query<{ t: string }>(
      `select table_name as t from information_schema.tables where table_schema = 'public'`,
    )
    expect(rows.map((r) => r.t)).toContain('kick_migrations')
    expect(rows.map((r) => r.t)).not.toContain('widgets')
  }, 60_000)
})
