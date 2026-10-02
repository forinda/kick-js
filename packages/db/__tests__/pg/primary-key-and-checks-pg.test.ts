/**
 * D.8 against a real Postgres: a primary key moved to a named composite key
 * (and back), and CHECK constraints added and replaced — each migration
 * applied, then the catalog and the constraint behaviour checked.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import pg from 'pg'
import {
  check,
  diff,
  emitPg,
  extractSnapshot,
  integer,
  invertChanges,
  primaryKey,
  serial,
  table,
} from '@forinda/kickjs-db'

let container: StartedPostgreSqlContainer
let pool: pg.Pool

const v1 = {
  memberships: table('memberships', {
    id: serial().primaryKey(),
    teamId: integer().notNull(),
    userId: integer().notNull(),
  }),
}
const v2 = {
  memberships: table(
    'memberships',
    { id: serial(), teamId: integer().notNull(), userId: integer().notNull() },
    (t) => ({
      pk: primaryKey('memberships_pk').on(t.teamId, t.userId),
      positive: check('team_positive', '"teamId" > 0'),
    }),
  ),
}
const snap = (s: Record<string, unknown>) => extractSnapshot(s, 'postgres')

const keyOf = async () =>
  (
    await pool.query(`
      SELECT c.conname, array_agg(a.attname ORDER BY k.ord)::text[] AS cols
      FROM pg_constraint c
      CROSS JOIN LATERAL unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord)
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
      WHERE c.conrelid = 'memberships'::regclass AND c.contype = 'p'
      GROUP BY c.conname`)
  ).rows[0]

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start()
  pool = new pg.Pool({
    host: container.getHost(),
    port: container.getMappedPort(5432),
    user: container.getUsername(),
    password: container.getPassword(),
    database: container.getDatabase(),
  })
  pool.on('error', () => {})
  await pool.query(emitPg(diff(snap({}), snap(v1))))
  await pool.query(`INSERT INTO memberships ("teamId", "userId") VALUES (1, 1), (1, 2)`)
}, 120_000)

afterAll(async () => {
  await pool?.end()
  await container?.stop()
})

describe('primary-key and CHECK migrations (postgres)', () => {
  it('moves the key to a named composite key, keeping rows, and adds the CHECK', async () => {
    await pool.query(emitPg(diff(snap(v1), snap(v2))))
    expect(await keyOf()).toEqual({ conname: 'memberships_pk', cols: ['teamId', 'userId'] })
    expect((await pool.query('SELECT count(*)::int AS n FROM memberships')).rows[0].n).toBe(2)
    await expect(
      pool.query(`INSERT INTO memberships ("teamId", "userId") VALUES (1, 1)`),
    ).rejects.toMatchObject({ code: '23505', constraint: 'memberships_pk' })
    await expect(
      pool.query(`INSERT INTO memberships ("teamId", "userId") VALUES (0, 9)`),
    ).rejects.toMatchObject({ code: '23514', constraint: 'team_positive' })
  })

  it('the down migration restores the original key and drops the CHECK', async () => {
    await pool.query(emitPg(invertChanges(diff(snap(v1), snap(v2)))))
    expect(await keyOf()).toEqual({ conname: 'memberships_pkey', cols: ['id'] })
    await pool.query(`INSERT INTO memberships ("teamId", "userId") VALUES (0, 1)`)
  })
})
