/**
 * Database-per-tenant on the suite's shared Postgres: each tenant's database
 * is a copy of one template, made while other test files use the same server.
 * Proves the shared setup holds for the hardest common case — isolated data,
 * identical schemas, many tenants created at once.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import pg from 'pg'
import { createDbClient, defineTenancy, serial, table, text } from '@forinda/kickjs-db'
import { pgDialect } from '@forinda/kickjs-db/pg'
import { createPgTestDb, type PgTestDb } from '@forinda/kickjs-db/testing'

const notes = table('notes', { id: serial().primaryKey(), body: text().notNull() })
const schema = { notes }
const TENANTS = ['acme', 'globex', 'initech', 'umbrella', 'hooli']

let central: PgTestDb<typeof schema>
const tenantDbs = new Map<string, PgTestDb<typeof schema>>()
const pools: pg.Pool[] = []

beforeAll(async () => {
  central = await createPgTestDb({ schema })
  // All at once: they race for the same template, as parallel test files do.
  // Settled, not all(): the ones that made it are dropped in afterAll either way.
  const made = await Promise.allSettled(TENANTS.map(() => createPgTestDb({ schema })))
  made.forEach((r, i) => r.status === 'fulfilled' && tenantDbs.set(TENANTS[i]!, r.value))
  const failed = made.find((r): r is PromiseRejectedResult => r.status === 'rejected')
  if (failed) throw failed.reason
}, 60_000)

afterAll(async () => {
  await Promise.all(pools.map((p) => p.end()))
  await Promise.all([central, ...tenantDbs.values()].map((d) => d?.drop()))
})

async function columns(url: string) {
  const c = new pg.Client({ connectionString: url })
  await c.connect()
  try {
    const { rows } = await c.query(
      `select table_name, column_name, data_type, is_nullable, column_default
         from information_schema.columns where table_schema = 'public' order by 1, 2`,
    )
    return rows
  } finally {
    await c.end()
  }
}

describe("'database' tenancy on a shared server", () => {
  it('gives every tenant its own database with the identical schema', async () => {
    const urls = [...tenantDbs.values()].map((d) => d.connectionString)
    expect(new Set(urls).size).toBe(TENANTS.length)
    const expected = await columns(central.connectionString)
    expect(expected.length).toBeGreaterThan(0)
    for (const url of urls) expect(await columns(url)).toEqual(expected)
  })

  it("keeps each tenant's rows in its own database, transactions included", async () => {
    const tenancy = defineTenancy({
      strategy: 'database',
      dialectFor: (id) => {
        const pool = new pg.Pool({ connectionString: tenantDbs.get(id)!.connectionString })
        pool.on('error', () => {})
        pools.push(pool)
        return pgDialect({ pool })
      },
    })
    const centralPool = new pg.Pool({ connectionString: central.connectionString })
    centralPool.on('error', () => {})
    pools.push(centralPool)
    const db = createDbClient({ schema, tenancy, dialect: pgDialect({ pool: centralPool }) })

    await Promise.all(
      TENANTS.map((id) =>
        tenancy.run(id, async () => {
          await db
            .insertInto('notes')
            .values({ body: `${id}-1` })
            .execute()
          await db.transaction((tx) =>
            tx
              .insertInto('notes')
              .values({ body: `${id}-2` })
              .execute(),
          )
        }),
      ),
    )
    for (const id of TENANTS) {
      const rows = await tenancy.run(id, () =>
        db.selectFrom('notes').select('body').orderBy('id').execute(),
      )
      expect(rows).toEqual([{ body: `${id}-1` }, { body: `${id}-2` }])
    }
    // The central database saw none of it.
    expect(await central.db.selectFrom('notes').selectAll().execute()).toEqual([])
  })
})
