/** 'column' and 'rls' tenancy on Postgres with a uuid, ULID (varchar(26)) or integer tenant column. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import pg from 'pg'
import { createDbClient, defineTenancy, diff, emitPg, extractSnapshot } from '@forinda/kickjs-db'
import { pgDialect } from '@forinda/kickjs-db/pg'
import {
  tenantKeyCases,
  tenantKeyFlow,
  tenantKeyNamings,
  tenantKeySchema,
} from '../setup/tenant-key-types'

let container: StartedPostgreSqlContainer
/** An ordinary owner: a superuser would skip the policies. */
let pool: pg.Pool
/** The superuser: what bypass() connects as under 'rls'. */
let adminPool: pg.Pool
const empty = { version: 1 as const, dialect: 'postgres' as const, tables: {} }

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start()
  const admin = new pg.Client({ connectionString: container.getConnectionUri() })
  await admin.connect()
  await admin.query(`CREATE ROLE app LOGIN PASSWORD 'app'`)
  await admin.query('CREATE DATABASE app OWNER app')
  await admin.end()
  const url = new URL(container.getConnectionUri())
  url.username = 'app'
  url.password = 'app'
  url.pathname = '/app'
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

describe.each(['column', 'rls'] as const)("'%s' tenancy", (strategy) => {
  it.each(tenantKeyCases)('$name tenant column: fills, filters, joins and checks', async (c) => {
    const tenancy = defineTenancy({
      strategy,
      bypassDialect: pgDialect({ pool: (async () => adminPool) as never }),
    })
    const schema = tenantKeySchema(tenancy, c)
    const snap = extractSnapshot(schema, 'postgres')
    if (strategy === 'rls') {
      expect(snap.tables.projects.policies?.[0]?.using).toMatch(
        new RegExp(`::${snap.tables.projects.columns.tenantId.type.replace(/[()]/g, '\\$&')}$`),
      )
    }
    await pool.query('DROP TABLE IF EXISTS projects, tasks')
    await pool.query(emitPg(diff(empty, snap)))
    const db = createDbClient({ schema, tenancy, dialect: pgDialect({ pool }) })
    await tenantKeyFlow(db, tenancy, c)
  })
})

describe.each(['column', 'rls'] as const)("'%s' tenancy, tenant column naming", (strategy) => {
  it.each(tenantKeyNamings)('$name', async (naming) => {
    const c = tenantKeyCases.find((k) => k.name === 'uuid()')!
    const tenancy = defineTenancy({
      strategy,
      bypassDialect: pgDialect({ pool: (async () => adminPool) as never }),
    })
    const schema = tenantKeySchema(tenancy, c, naming)
    const snap = extractSnapshot(schema, 'postgres', { casing: naming.casing })
    const ddl = emitPg(diff(empty, snap))
    expect(ddl).toContain(`"${naming.dbName}"`)
    if (strategy === 'rls') {
      expect(snap.tables.projects.policies?.[0]?.using).toBe(
        `"${naming.dbName}" = nullif(current_setting('app.tenant_id', true), '')::uuid`,
      )
    }
    await pool.query('DROP TABLE IF EXISTS projects, tasks')
    await pool.query(ddl)
    const db = createDbClient({
      schema,
      tenancy,
      casing: naming.casing,
      dialect: pgDialect({ pool }),
    })
    await tenantKeyFlow(db, tenancy, c, naming.key)
    const raw = await adminPool.query(`SELECT "${naming.dbName}" AS t FROM projects ORDER BY id`)
    expect(raw.rows.map((r) => r.t)).toEqual([c.nativeA, c.nativeB, c.nativeA])
  })
})
