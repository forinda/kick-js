/**
 * Postgres examples from the docs, run as written: JSON operators (Raw SQL
 * and recipes) and row-level security per tenant (Multi-tenancy) — the latter
 * as a non-owner role, since owners and superusers bypass policies.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import pg from 'pg'
import { PostgresDialect, sql } from 'kysely'
import {
  createDbClient,
  diff,
  emitPg,
  extractSnapshot,
  integer,
  jsonb,
  serial,
  table,
  text,
  type KickDbClient,
} from '@forinda/kickjs-db'
import { policy } from '@forinda/kickjs-db/pg'

const events = table('events', {
  id: serial().primaryKey(),
  data: jsonb<{ kind: string; tags: string[] }>().notNull(),
})
// ── the docs' schema: the policy is declared with the table ──
const tenant = `current_setting('app.tenant_id', true)`
const notes = table(
  'notes',
  { id: serial().primaryKey(), tenantId: text().notNull(), body: text().notNull(), n: integer() },
  {
    constraints: () => ({
      tenantIsolation: policy('tenant_isolation')
        .using(`"tenantId" = ${tenant}`)
        .withCheck(`"tenantId" = ${tenant}`),
    }),
  },
)
const schema = { events, notes }

let container: StartedPostgreSqlContainer
let admin: pg.Pool
let appPool: pg.Pool
let db: ReturnType<typeof make>
const make = (pool: pg.Pool) => createDbClient({ schema, dialect: new PostgresDialect({ pool }) })

// ── the docs' helper ──
function withTenant<T>(client: KickDbClient<any>, tenantId: string, fn: () => Promise<T>) {
  // Local to this transaction: it can't leak to the next user of the connection.
  return client.transaction({ settings: { 'app.tenant_id': tenantId } }, () => fn())
}

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start()
  admin = new pg.Pool({ connectionString: container.getConnectionUri() })
  admin.on('error', () => {})
  const empty = { version: 1 as const, dialect: 'postgres' as const, tables: {} }
  await admin.query(emitPg(diff(empty, extractSnapshot({ notes }, 'postgres'))))
  await admin.query(`
    CREATE TABLE events (id serial PRIMARY KEY, data jsonb NOT NULL);
    INSERT INTO events (data) VALUES
      ('{"kind":"signup","tags":["web"]}'), ('{"kind":"login","tags":["web","mobile"]}');


    CREATE ROLE app LOGIN PASSWORD 'app';
    GRANT SELECT, INSERT, UPDATE, DELETE ON notes, events TO app;
    GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO app;
  `)
  await admin.query(
    `INSERT INTO notes ("tenantId", body) VALUES ('acme', 'a1'), ('acme', 'a2'), ('globex', 'g1')`,
  )
  const uri = new URL(container.getConnectionUri())
  uri.username = 'app'
  uri.password = 'app'
  appPool = new pg.Pool({ connectionString: uri.toString(), max: 2 })
  appPool.on('error', () => {})
  db = make(appPool)
}, 120_000)

afterAll(async () => {
  await db?.destroy()
  await admin?.end()
  await container?.stop()
})

describe('JSON (postgres)', () => {
  it('filters and selects inside jsonb', async () => {
    const rows = await db
      .selectFrom('events')
      .select(['id', sql<string>`data->>'kind'`.as('kind')])
      .where(sql<boolean>`data->'tags' ? ${'mobile'}`)
      .execute()
    expect(rows).toEqual([{ id: 2, kind: 'login' }])
  })
})

describe('row-level security per tenant', () => {
  // A repository that knows nothing about tenants.
  const notesRepo = {
    list: () => db.selectFrom('notes').select('body').orderBy('body').execute(),
    add: (tenantId: string, body: string) =>
      db.insertInto('notes').values({ tenantId, body }).execute(),
  }

  it('each tenant sees only its rows', async () => {
    expect((await withTenant(db, 'acme', () => notesRepo.list())).map((r) => r.body)).toEqual([
      'a1',
      'a2',
    ])
    expect((await withTenant(db, 'globex', () => notesRepo.list())).map((r) => r.body)).toEqual([
      'g1',
    ])
  })

  it('outside withTenant nothing is visible', async () => {
    expect(await notesRepo.list()).toEqual([])
  })

  it("can't write another tenant's rows", async () => {
    await expect(withTenant(db, 'acme', () => notesRepo.add('globex', 'sneaky'))).rejects.toThrow(
      /row-level security/,
    )
  })

  it("concurrent requests don't see each other's tenant, even on a shared pool", async () => {
    const results = await Promise.all(
      ['acme', 'globex', 'acme', 'globex'].map((t) => withTenant(db, t, () => notesRepo.list())),
    )
    expect(results.map((r) => r.length)).toEqual([2, 1, 2, 1])
  })
})
