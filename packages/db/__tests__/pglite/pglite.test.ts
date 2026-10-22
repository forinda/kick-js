/**
 * PGlite through `pglitePool()`: one caller at a time, the client and the
 * migration runner on one embedded database — and, on real Postgres SQL, the
 * stale-lock takeover and the drift check's ignore list.
 */
import { describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import {
  appendJournalEntry,
  computeMigrationHash,
  createDbClient,
  diff,
  emitPg,
  extractSnapshot,
  integer,
  jsonb,
  timestamptz,
  migrateLatest,
  MigrationDriftError,
  MigrationLockError,
  serial,
  table,
  text,
  type SchemaSnapshot,
} from '@forinda/kickjs-db'
import { pgAdapter, pgDialect } from '@forinda/kickjs-db/pg'
import { pglitePool } from '@forinda/kickjs-db/pglite'

const notes = table('notes', { id: serial().primaryKey(), body: text().notNull() })
const v1 = extractSnapshot({ notes }, 'postgres')
const v2 = extractSnapshot(
  {
    notes: table('notes', { id: serial().primaryKey(), body: text().notNull(), stars: integer() }),
  },
  'postgres',
)
const empty: SchemaSnapshot = { version: 1, dialect: 'postgres', tables: {} }

async function writeMigration(dir: string, id: string, from: SchemaSnapshot, to: SchemaSnapshot) {
  const out = path.join(dir, id)
  await mkdir(out, { recursive: true })
  await writeFile(path.join(out, 'up.sql'), emitPg(diff(from, to)))
  await writeFile(path.join(out, 'down.sql'), '')
  await writeFile(path.join(out, 'snapshot.json'), JSON.stringify(to))
  await writeFile(
    path.join(out, 'meta.json'),
    JSON.stringify({ id, name: id, reviewed: true, dialect: 'postgres', previousId: null }),
  )
  await appendJournalEntry(dir, 'postgres', {
    id,
    tag: id,
    hash: await computeMigrationHash(out),
    createdAt: new Date().toISOString(),
  })
}

async function setup() {
  const pool = pglitePool(new PGlite())
  const adapter = pgAdapter({ pool })
  const dir = await mkdtemp(path.join(tmpdir(), 'kickdb-pglite-'))
  await writeMigration(dir, '20260101_000000_init', empty, v1)
  return { pool, adapter, dir }
}

describe('pglitePool', () => {
  it('migrates, then queries through the same database', async () => {
    const { pool, adapter, dir } = await setup()
    expect(await migrateLatest({ adapter, migrationsDir: dir })).toMatchObject({
      applied: ['20260101_000000_init'],
    })
    const db = createDbClient({ schema: { notes }, dialect: pgDialect({ pool }) })
    await db.insertInto('notes').values({ body: 'a' }).execute()
    const updated = await db.updateTable('notes').set({ body: 'b' }).executeTakeFirst()
    expect(updated.numUpdatedRows).toBe(1n)
    await expect(
      db.transaction(async (trx) => {
        await trx.insertInto('notes').values({ body: 'c' }).execute()
        throw new Error('roll back')
      }),
    ).rejects.toThrow('roll back')
    expect(await db.selectFrom('notes').select('body').execute()).toEqual([{ body: 'b' }])
    await pool.end!()
  })

  it("hands the connection to one caller at a time — nobody runs inside another's transaction", async () => {
    const { pool } = await setup()
    await pool.query('create table t (n int)')
    const client = await pool.connect()
    await client.query('begin')
    await client.query('insert into t values (1)')
    let counted: unknown
    const outside = pool.query('select count(*)::int as n from t').then((r) => (counted = r.rows))
    await new Promise((r) => setTimeout(r, 50))
    expect(counted).toBeUndefined() // waiting for the client
    await client.query('rollback')
    client.release()
    await outside
    expect(counted).toEqual([{ n: 0 }])
    await pool.end!()
  })
})

describe('migration lock on Postgres', () => {
  const holdLock = (pool: ReturnType<typeof pglitePool>, ago: string) =>
    pool.query(
      `update kick_migrations_lock set locked_by = 'dead', locked_at = now() - interval '${ago}' where id = 1`,
    )

  it('takes over a lock nobody refreshed within lockStaleAfter', async () => {
    const { pool, adapter, dir } = await setup()
    await adapter.ensureMigrationTables()
    await holdLock(pool, '2 minutes')
    await expect(
      migrateLatest({ adapter, migrationsDir: dir, lockStaleAfter: 60 }),
    ).resolves.toMatchObject({ applied: ['20260101_000000_init'] })
    const { rows } = await pool.query('select locked_at from kick_migrations_lock')
    expect(rows).toEqual([{ locked_at: null }])
  })

  it('leaves a recently refreshed lock alone, and never takes one over with 0', async () => {
    const { pool, adapter, dir } = await setup()
    await adapter.ensureMigrationTables()
    await holdLock(pool, '10 seconds')
    await expect(
      migrateLatest({ adapter, migrationsDir: dir, lockStaleAfter: 60 }),
    ).rejects.toBeInstanceOf(MigrationLockError)
    await holdLock(pool, '2 days')
    await expect(
      migrateLatest({ adapter, migrationsDir: dir, lockStaleAfter: 0 }),
    ).rejects.toBeInstanceOf(MigrationLockError)
  })

  it('refreshLock moves only its own lock forward, and says when it lost it', async () => {
    const { pool, adapter } = await setup()
    await adapter.ensureMigrationTables()
    await holdLock(pool, '1 hour')
    expect(await adapter.refreshLock!('someone else')).toBe(false)
    expect(await adapter.acquireLock('me', 60)).toBe(true)
    await pool.query(`update kick_migrations_lock set locked_at = now() - interval '1 hour'`)
    expect(await adapter.refreshLock!('me')).toBe(true)
    expect(await adapter.acquireLock('other', 60)).toBe(false)
  })

  it("a run whose lock was taken over doesn't release the new holder's", async () => {
    const { pool, adapter } = await setup()
    await adapter.ensureMigrationTables()
    expect(await adapter.acquireLock('a')).toBe(true)
    // a stopped refreshing
    await pool.query(`update kick_migrations_lock set locked_at = now() - interval '1 hour'`)
    expect(await adapter.acquireLock('b', 60)).toBe(true)
    await adapter.releaseLock('a')
    expect(await adapter.acquireLock('c', 60)).toBe(false)
    await adapter.releaseLock('b')
    expect(await adapter.acquireLock('c')).toBe(true)
    await adapter.releaseLock() // unlock: whoever holds it
    expect(await adapter.acquireLock('d')).toBe(true)
  })
})

describe('driftIgnore', () => {
  it('leaves out indexes the app creates at runtime', async () => {
    const { pool, adapter, dir } = await setup()
    await migrateLatest({ adapter, migrationsDir: dir })
    await pool.query(`create index ix_e_1a2b on notes ((lower(body))) where body <> ''`)
    await writeMigration(dir, '20260102_000000_stars', v1, v2)

    await expect(migrateLatest({ adapter, migrationsDir: dir })).rejects.toBeInstanceOf(
      MigrationDriftError,
    )
    // `g` keeps lastIndex between test() calls; the check must not care.
    await expect(
      migrateLatest({ adapter, migrationsDir: dir, driftIgnore: { indexes: /^ix_e_/g } }),
    ).resolves.toMatchObject({ applied: ['20260102_000000_stars'] })
  })
})

describe('drift on .defaultSql() casts', () => {
  it("reads '{}'::jsonb back as the same default", async () => {
    const pool = pglitePool(new PGlite())
    const adapter = pgAdapter({ pool })
    const dir = await mkdtemp(path.join(tmpdir(), 'kickdb-pglite-'))
    const cols = {
      id: serial().primaryKey(),
      meta: jsonb().notNull().defaultSql("'{}'::jsonb"),
      tags: text().array().notNull().defaultSql("'{}'::text[]"),
      labels: text().array().notNull().default('{}'),
      ids: integer().array().default('{1,2}'),
      roles: text().array().notNull().defaultSql('ARRAY[]::text[]'),
      key: text().defaultSql('gen_random_uuid()::text'),
      at: timestamptz().notNull().defaultSql('now()'),
      note: text().defaultSql("'left::right'"),
    }
    const a = extractSnapshot({ docs: table('docs', cols) }, 'postgres')
    const b = extractSnapshot({ docs: table('docs', { ...cols, title: text() }) }, 'postgres')
    await writeMigration(dir, '20260101_000000_init', empty, a)
    await migrateLatest({ adapter, migrationsDir: dir })
    await writeMigration(dir, '20260102_000000_title', a, b)
    await expect(migrateLatest({ adapter, migrationsDir: dir })).resolves.toMatchObject({
      applied: ['20260102_000000_title'],
    })
  })

  it('catches a cast added to an expression default', async () => {
    const pool = pglitePool(new PGlite())
    const adapter = pgAdapter({ pool })
    const dir = await mkdtemp(path.join(tmpdir(), 'kickdb-pglite-'))
    const cols = {
      id: serial().primaryKey(),
      ref: text().defaultSql('(now())::text'),
    }
    const a = extractSnapshot({ docs: table('docs', cols) }, 'postgres')
    const b = extractSnapshot({ docs: table('docs', { ...cols, title: text() }) }, 'postgres')
    await writeMigration(dir, '20260101_000000_init', empty, a)
    await migrateLatest({ adapter, migrationsDir: dir })
    await pool.query('alter table docs alter column ref set default now()::varchar')
    await writeMigration(dir, '20260102_000000_title', a, b)
    await expect(migrateLatest({ adapter, migrationsDir: dir })).rejects.toBeInstanceOf(
      MigrationDriftError,
    )
  })

  it('catches a fixed string replaced by a generated one', async () => {
    const pool = pglitePool(new PGlite())
    const adapter = pgAdapter({ pool })
    const dir = await mkdtemp(path.join(tmpdir(), 'kickdb-pglite-'))
    const cols = {
      id: serial().primaryKey(),
      ref: text().defaultSql("'(gen_random_uuid())'::text"),
    }
    const a = extractSnapshot({ docs: table('docs', cols) }, 'postgres')
    const b = extractSnapshot({ docs: table('docs', { ...cols, title: text() }) }, 'postgres')
    await writeMigration(dir, '20260101_000000_init', empty, a)
    await migrateLatest({ adapter, migrationsDir: dir })
    await pool.query('alter table docs alter column ref set default gen_random_uuid()::text')
    await writeMigration(dir, '20260102_000000_title', a, b)
    await expect(migrateLatest({ adapter, migrationsDir: dir })).rejects.toBeInstanceOf(
      MigrationDriftError,
    )
  })
})
