/**
 * What 'rls' binding costs per query. Run with KICK_BENCH=1:
 *   KICK_BENCH=1 pnpm vitest run __tests__/bench/tenancy-binding-pg.test.ts
 * Prints a table; asserts nothing beyond the queries succeeding.
 */
import { afterAll, beforeAll, describe, it } from 'vitest'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import pg from 'pg'
import { writeFileSync } from 'node:fs'
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

const run = process.env.KICK_BENCH === '1'
const N = 2000
let container: StartedPostgreSqlContainer
let pool: pg.Pool

describe.skipIf(!run)('rls binding cost', () => {
  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:16-alpine').start()
    const admin = new pg.Client({ connectionString: container.getConnectionUri() })
    await admin.connect()
    await admin.query(`CREATE ROLE app LOGIN PASSWORD 'app'`)
    await admin.query('CREATE DATABASE app OWNER app')
    await admin.end()
    const url = new URL(container.getConnectionUri())
    Object.assign(url, { username: 'app', password: 'app', pathname: '/app' })
    pool = new pg.Pool({ connectionString: url.toString(), max: 4 })
  }, 120_000)
  afterAll(async () => {
    await pool?.end()
    await container?.stop()
  })

  it('times the same reads under each binding', async () => {
    const make = (binding?: 'transaction' | 'connection') => {
      const tenancy = defineTenancy({ strategy: 'rls', binding: binding ?? 'transaction' })
      const notes = table('notes', {
        id: serial().primaryKey(),
        tenantId: tenantKey(tenancy),
        body: text(),
      })
      return { tenancy, notes }
    }
    const { notes } = make()
    const empty = { version: 1 as const, dialect: 'postgres' as const, tables: {} }
    await pool.query(emitPg(diff(empty, extractSnapshot({ notes }, 'postgres'))))
    // Seed with the policy lifted for the owner, then held to it again.
    await pool.query(`ALTER TABLE notes NO FORCE ROW LEVEL SECURITY;
      INSERT INTO notes ("tenantId", body) SELECT 't' || (g % 50), 'x' FROM generate_series(1, 5000) g;
      ALTER TABLE notes FORCE ROW LEVEL SECURITY;
      CREATE INDEX ON notes ("tenantId");`)

    // Simulated network round trip: every statement waits this long first.
    const withLatency = (ms: number) => {
      const p = new pg.Pool({
        connectionString: (pool as unknown as { options: { connectionString: string } }).options
          .connectionString,
        max: 4,
      })
      if (ms === 0) return p
      const connect = p.connect.bind(p)
      p.connect = (async () => {
        const client = await connect()
        if (!(client as unknown as { __slow?: true }).__slow) {
          const query = client.query.bind(client)
          ;(client as unknown as { query: unknown }).query = async (...args: unknown[]) => {
            await new Promise((r) => setTimeout(r, ms))
            return (query as (...a: unknown[]) => unknown)(...args)
          }
          ;(client as unknown as { __slow?: true }).__slow = true
        }
        return client
      }) as never
      return p
    }

    const rows: string[] = []
    for (const latency of [0, 1]) {
      const timed = async (
        label: string,
        perQuery: (i: number) => Promise<unknown>,
        count: number,
      ) => {
        const t0 = performance.now()
        for (let i = 0; i < count; i++) await perQuery(i)
        const us = ((performance.now() - t0) / count) * 1000
        rows.push(
          `${String(latency).padStart(3)} ms | ${label.padEnd(44)} | ${us.toFixed(0).padStart(7)} µs/query`,
        )
      }
      const count = latency === 0 ? N : 200
      const p = withLatency(latency)
      const plain = createDbClient({ schema: { notes }, dialect: pgDialect({ pool: p }) })
      await timed(
        'no tenancy (plain client)',
        () =>
          plain.selectFrom('notes').select('id').where('tenantId', '=', 't1').limit(1).execute(),
        count,
      )
      for (const binding of ['connection', 'transaction'] as const) {
        const { tenancy, notes: n } = make(binding)
        const db = createDbClient({
          schema: { notes: n },
          tenancy,
          dialect: pgDialect({ pool: p }),
        })
        await timed(
          `rls, ${binding} binding, lone queries`,
          (i) =>
            tenancy.run(`t${i % 50}`, () => db.selectFrom('notes').select('id').limit(1).execute()),
          count,
        )
        await timed(
          `rls, ${binding} binding, 10 per db.transaction()`,
          (i) =>
            i % 10 === 0
              ? tenancy.run(`t${i % 50}`, () =>
                  db.transaction(async (tx) => {
                    for (let k = 0; k < 10; k++)
                      await tx.selectFrom('notes').select('id').limit(1).execute()
                  }),
                )
              : Promise.resolve(),
          count,
        )
      }
      await p.end()
    }
    const output = ['latency | case | cost', ...rows].join('\n')
    // Vitest swallows a passing test's console: write it where it can be read.
    if (process.env.KICK_BENCH_OUT) writeFileSync(process.env.KICK_BENCH_OUT, output + '\n')
    else process.stdout.write(output + '\n')
  }, 300_000)
})
