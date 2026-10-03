/** Tenancy experiment on Postgres: the 'rls' and 'schema' strategies. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import pg from 'pg'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  createDbClient,
  defineTenancy,
  diff,
  emitPg,
  extractSnapshot,
  generate,
  migrateTenants,
  serial,
  table,
  tenantKey,
  text,
} from '@forinda/kickjs-db'
import { pgAdapter, pgDialect } from '@forinda/kickjs-db/pg'
import { requestStore } from '@forinda/kickjs'
import { sql } from 'kysely'

const here = path.dirname(fileURLToPath(import.meta.url))
let container: StartedPostgreSqlContainer
let pool: pg.Pool
/** The superuser: what the bypass dialect connects as here (it skips RLS). */
let adminPool: pg.Pool
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
  const adminUrl = new URL(container.getConnectionUri())
  adminUrl.pathname = '/app'
  adminPool = new pg.Pool({ connectionString: adminUrl.toString(), max: 1 })
}, 120_000)
afterAll(async () => {
  await pool?.end()
  await adminPool?.end()
  await container?.stop()
}, 60_000)

describe.each(['transaction', 'connection'] as const)("'rls' tenancy, %s binding", (binding) => {
  const audit: string[] = []
  const tenancy = defineTenancy({
    strategy: 'rls',
    binding,
    // A thunk: the pool exists only once beforeAll has run.
    bypassDialect: pgDialect({ pool: (async () => adminPool) as never }),
    onBypass: (info) => audit.push(info.reason),
  })
  // Each binding gets its own table, so the two runs don't see each other's rows.
  const notes = table(`notes_${binding}`, {
    id: serial().primaryKey(),
    tenantId: tenantKey(tenancy),
    body: text().notNull(),
  })

  it('generates the policy, and hands each connection the tenant', async () => {
    const snap = extractSnapshot({ notes }, 'postgres')
    expect(snap.tables[`notes_${binding}`].rls).toEqual({ force: true })
    expect(snap.tables[`notes_${binding}`].policies?.[0]).toMatchObject({
      name: `notes_${binding}_tenant`,
      using: `"tenantId" = nullif(current_setting('app.tenant_id', true), '')::text`,
    })
    await pool.query(emitPg(diff(empty, snap)))

    const db = createDbClient({ schema: { notes }, tenancy, dialect: pgDialect({ pool }) })
    const t = `notes_${binding}` as 'notes_transaction'
    await tenancy.run('acme', () => db.insertInto(t).values({ body: 'a1' }).execute())
    await tenancy.run('globex', () => db.insertInto(t).values({ body: 'g1' }).execute())

    const bodies = (tenant: string) =>
      tenancy.run(tenant, () => db.selectFrom(t).select('body').execute())
    expect(await bodies('acme')).toEqual([{ body: 'a1' }])
    expect(await bodies('globex')).toEqual([{ body: 'g1' }])
    expect(await bodies('acme')).toEqual([{ body: 'a1' }]) // same connection, switched back
    // A tenant id with a quote: quoted as a literal, never spliced as SQL.
    const odd = "o'brien'); drop table notes; --"
    await tenancy.run(odd, () => db.insertInto(t).values({ body: 'odd' }).execute())
    expect(await bodies(odd)).toEqual([{ body: 'odd' }])
    // No tenant: the policy matches nothing.
    expect(await db.selectFrom(t).selectAll().execute()).toEqual([])
    // The database refuses another tenant's row.
    await expect(
      tenancy.run('acme', () =>
        db.insertInto(t).values({ body: 'x', tenantId: 'globex' }).execute(),
      ),
    ).rejects.toThrow()
    // A rolled-back transaction doesn't take the tenant with it.
    await tenancy.run('globex', async () => {
      await expect(
        db.transaction(async (tx) => {
          await tx.insertInto(t).values({ body: 'rolled back' }).execute()
          throw new Error('boom')
        }),
      ).rejects.toThrow('boom')
      expect(await db.selectFrom(t).select('body').execute()).toEqual([{ body: 'g1' }])
    })

    // What a transaction-mode pooler would hand the next client: the setting
    // lives on the connection only with 'connection' binding.
    await tenancy.run('acme', () => db.selectFrom(t).selectAll().execute())
    const { rows } = await pool.query(`select current_setting('app.tenant_id', true) as v`)
    expect(rows[0].v).toBe(binding === 'connection' ? 'acme' : '')

    // bypass: the bypass dialect's connection, audited and tagged.
    const all = await tenancy.bypass(
      () => db.selectFrom(t).select('body').orderBy('body').execute(),
      { reason: 'monthly report' },
    )
    expect(all).toEqual([{ body: 'a1' }, { body: 'g1' }, { body: 'odd' }])
    expect(audit).toContain('monthly report')
    const tagged = await tenancy.bypass(
      () =>
        sql<{ name: string }>`select current_setting('application_name') as name`.execute(db.qb),
      { reason: 'check tag' },
    )
    expect(tagged.rows[0]!.name).toBe('kick-bypass')
  })
})

describe("'rls' tenancy guardrails", () => {
  const tenancy = defineTenancy({ strategy: 'rls' })

  it('bypass needs a bypassDialect, a reason, and allowInRequest inside a request', () => {
    expect(() => tenancy.bypass(() => 1, { reason: 'x' })).toThrow(/bypassDialect/)
    const withAdmin = defineTenancy({ strategy: 'column' })
    expect(() => withAdmin.bypass(() => 1, {} as never)).toThrow(/needs a reason/)
    const inRequest = () =>
      requestStore.run({ requestId: 'r', instances: new Map(), values: new Map() } as never, () =>
        withAdmin.bypass(() => 'ok', { reason: 'x' }),
      )
    expect(inRequest).toThrow(/allowInRequest/)
    expect(
      requestStore.run({ requestId: 'r', instances: new Map(), values: new Map() } as never, () =>
        withAdmin.bypass(() => 'ok', { reason: 'x', allowInRequest: true }),
      ),
    ).toBe('ok')
  })

  it('refuses to run as a role the policies never apply to', async () => {
    const notes = table('guard_notes', { id: serial().primaryKey(), tenantId: tenantKey(tenancy) })
    const db = createDbClient({
      schema: { notes },
      tenancy,
      dialect: pgDialect({ pool: adminPool }),
    })
    await expect(tenancy.run('acme', () => sql`select 1`.execute(db.qb))).rejects.toThrow(
      /superuser/,
    )
    const warned = defineTenancy({ strategy: 'rls', roleCheck: 'warn' })
    const lenient = createDbClient({
      schema: {},
      tenancy: warned,
      dialect: pgDialect({ pool: adminPool }),
    })
    await expect(warned.run('acme', () => sql`select 1`.execute(lenient.qb))).resolves.toBeDefined()
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

describe('migrateTenants (schema per tenant)', () => {
  it('migrates every tenant schema, reports failures, and rolls out a later migration', async () => {
    const dir = await mkdtemp(path.join(here, '../fixtures/tmp-tenants-pg-'))
    try {
      const tenancy = defineTenancy({ strategy: 'schema', schemaFor: (id) => `ts_${id}` })
      const config = {
        schemaPath: path.join(dir, 'schema.ts'),
        migrationsDir: path.join(dir, 'migrations'),
        dialect: 'postgres' as const,
      }
      const base = `import { serial, table, text } from '@forinda/kickjs-db'
export const orders = table('orders', { id: serial().primaryKey(), ref: text().notNull() })`
      await writeFile(config.schemaPath, base)
      await generate({ name: 'init', config, cwd: dir })

      const url = new URL(container.getConnectionUri())
      url.username = 'app'
      url.password = 'app'
      url.pathname = '/app'
      const adapterFor = async (id: string) => {
        if (id === 'broken') throw new Error('no database for broken')
        const schema = tenancy.schemaFor(id)
        await pool.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`)
        const tenantPool = new pg.Pool({
          connectionString: url.toString(),
          options: `-c search_path=${schema}`,
        })
        return pgAdapter({ pool: tenantPool, schema, endPoolOnClose: true })
      }
      const run = () =>
        migrateTenants({
          tenants: async () => ['acme', 'broken', 'globex'],
          adapterFor,
          migrationsDir: config.migrationsDir,
          requireReviewed: false,
        })

      const first = await run()
      expect(first.failed).toEqual(['broken'])
      expect(first.results.find((r) => r.tenant === 'acme')?.summary?.applied).toHaveLength(1)

      await writeFile(
        config.schemaPath,
        base.replace('ref: text().notNull()', 'ref: text().notNull(), note: text()'),
      )
      await generate({ name: 'note', config, cwd: dir })
      const second = await run()
      expect(second.results.filter((r) => r.summary).map((r) => r.summary!.applied.length)).toEqual(
        [1, 1],
      )

      const orders = table('orders', {
        id: serial().primaryKey(),
        ref: text().notNull(),
        note: text(),
      })
      const db = createDbClient({ schema: { orders }, tenancy, dialect: pgDialect({ pool }) })
      await tenancy.run('globex', () =>
        db.insertInto('orders').values({ ref: 'G-1', note: 'x' }).execute(),
      )
      expect(
        await tenancy.run('globex', () =>
          db.selectFrom('orders').select(['ref', 'note']).execute(),
        ),
      ).toEqual([{ ref: 'G-1', note: 'x' }])
      expect(
        await tenancy.run('acme', () => db.selectFrom('orders').selectAll().execute()),
      ).toEqual([])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
