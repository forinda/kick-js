/** Tenancy experiment on Postgres: the 'rls' and 'schema' strategies. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import pg from 'pg'
import {
  createDbClient,
  defineTenancy,
  diff,
  emitPg,
  extractSnapshot,
  serial,
  table,
  tenantKey,
  text,
} from '@forinda/kickjs-db'
import { pgDialect } from '@forinda/kickjs-db/pg'

let container: StartedPostgreSqlContainer
let pool: pg.Pool
const empty = { version: 1 as const, dialect: 'postgres' as const, tables: {} }

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start()
  // A superuser bypasses RLS: connect as an ordinary owner.
  const admin = new pg.Client({ connectionString: container.getConnectionUri() })
  await admin.connect()
  await admin.query(`CREATE ROLE app LOGIN PASSWORD 'app'`)
  await admin.query('CREATE DATABASE app OWNER app')
  await admin.end()
  const url = new URL(container.getConnectionUri())
  url.username = 'app'
  url.password = 'app'
  url.pathname = '/app'
  // One connection: every query reuses it, switching tenant each time.
  pool = new pg.Pool({ connectionString: url.toString(), max: 1 })
}, 120_000)
afterAll(async () => {
  await pool?.end()
  await container?.stop()
}, 60_000)

describe("'rls' tenancy", () => {
  const tenancy = defineTenancy({ strategy: 'rls' })
  const notes = table('notes', {
    id: serial().primaryKey(),
    tenantId: tenantKey(tenancy),
    body: text().notNull(),
  })

  it('generates the policy, and hands each connection the tenant — no transaction', async () => {
    const snap = extractSnapshot({ notes }, 'postgres')
    expect(snap.tables.notes.rls).toEqual({ force: true })
    expect(snap.tables.notes.policies?.[0]).toMatchObject({
      name: 'notes_tenant',
      using: `"tenantId" = nullif(current_setting('app.tenant_id', true), '')::text`,
    })
    await pool.query(emitPg(diff(empty, snap)))

    const db = createDbClient({ schema: { notes }, tenancy, dialect: pgDialect({ pool }) })
    await tenancy.run('acme', () => db.insertInto('notes').values({ body: 'a1' }).execute())
    await tenancy.run('globex', () => db.insertInto('notes').values({ body: 'g1' }).execute())

    const bodies = (tenant: string) =>
      tenancy.run(tenant, () => db.selectFrom('notes').select('body').execute())
    expect(await bodies('acme')).toEqual([{ body: 'a1' }])
    expect(await bodies('globex')).toEqual([{ body: 'g1' }])
    expect(await bodies('acme')).toEqual([{ body: 'a1' }]) // same connection, switched back
    // No tenant: the policy matches nothing.
    expect(await db.selectFrom('notes').selectAll().execute()).toEqual([])
    // The database refuses another tenant's row.
    await expect(
      tenancy.run('acme', () =>
        db.insertInto('notes').values({ body: 'x', tenantId: 'globex' }).execute(),
      ),
    ).rejects.toThrow()
    // A rolled-back transaction doesn't take the tenant with it.
    await tenancy.run('globex', async () => {
      await expect(
        db.transaction(async (tx) => {
          await tx.insertInto('notes').values({ body: 'rolled back' }).execute()
          throw new Error('boom')
        }),
      ).rejects.toThrow('boom')
      expect(await db.selectFrom('notes').select('body').execute()).toEqual([{ body: 'g1' }])
    })
  })
})

describe("'schema' tenancy", () => {
  const tenancy = defineTenancy({ strategy: 'schema', schemaFor: (id) => `t_${id}` })
  const invoices = table('invoices', { id: serial().primaryKey(), number: text().notNull() })

  it('points each query at the tenant schema', async () => {
    const create = emitPg(diff(empty, extractSnapshot({ invoices }, 'postgres')))
    for (const id of ['acme', 'globex']) {
      await pool.query(
        `CREATE SCHEMA t_${id}; SET search_path TO t_${id}; ${create} RESET search_path;`,
      )
    }
    const db = createDbClient({ schema: { invoices }, tenancy, dialect: pgDialect({ pool }) })
    await tenancy.run('acme', () => db.insertInto('invoices').values({ number: 'A-1' }).execute())
    await tenancy.run('globex', () => db.insertInto('invoices').values({ number: 'G-1' }).execute())
    expect(
      await tenancy.run('acme', () => db.selectFrom('invoices').select('number').execute()),
    ).toEqual([{ number: 'A-1' }])
    const { rows } = await pool.query('SELECT number FROM t_globex.invoices')
    expect(rows).toEqual([{ number: 'G-1' }])
    await expect(db.selectFrom('invoices').selectAll().execute()).rejects.toThrow(/no tenant/)
  })
})
