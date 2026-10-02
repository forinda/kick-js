/**
 * D.20 on Postgres 17: identity and generated columns apply, behave, change
 * in place, and introspect back without drift.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import pg from 'pg'
import {
  checkDrift,
  diff,
  emitPg,
  extractSnapshot,
  integer,
  introspectPg,
  numeric,
  renderSchemaSource,
  table,
} from '@forinda/kickjs-db'

let container: StartedPostgreSqlContainer
let pool: pg.Pool

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:17-alpine').start()
  pool = new pg.Pool({ connectionString: container.getConnectionUri() })
  pool.on('error', () => {})
}, 120_000)

afterAll(async () => {
  await pool?.end()
  await container?.stop()
}, 60_000)

const orders = (total: string) =>
  table('orders', {
    id: integer().generatedAlwaysAsIdentity().primaryKey(),
    ref: integer().generatedByDefaultAsIdentity(),
    quantity: integer().notNull(),
    price: numeric(12, 2).notNull(),
    total: numeric(12, 2).generatedAlwaysAs(total),
  })

describe('generated and identity columns on Postgres', () => {
  it('apply, compute, refuse writes, change in place and introspect', async () => {
    const empty = { version: 1 as const, dialect: 'postgres' as const, tables: {} }
    const v1 = extractSnapshot({ orders: orders('price * quantity') }, 'postgres')
    await pool.query(emitPg(diff(empty, v1)))

    await pool.query(`INSERT INTO orders (quantity, price) VALUES (2, 3.50)`)
    await pool.query(`INSERT INTO orders (ref, quantity, price) VALUES (100, 1, 1)`)
    await expect(
      pool.query(`INSERT INTO orders (id, quantity, price) VALUES (9, 1, 1)`),
    ).rejects.toThrow(/non-DEFAULT value/)
    await expect(
      pool.query(`INSERT INTO orders (quantity, price, total) VALUES (1, 1, 5)`),
    ).rejects.toThrow(/non-DEFAULT value into column "total"/)
    const { rows } = await pool.query('SELECT id, ref, total FROM orders ORDER BY id')
    expect(rows).toEqual([
      { id: 1, ref: 1, total: '7.00' },
      { id: 2, ref: 100, total: '1.00' },
    ])

    const v2 = extractSnapshot({ orders: orders('price * quantity * 2') }, 'postgres')
    await pool.query(emitPg(diff(v1, v2)))
    const after = await pool.query('SELECT total FROM orders ORDER BY id')
    expect(after.rows.map((r) => r.total)).toEqual(['14.00', '2.00'])

    const live = await introspectPg(pool)
    expect(live.tables.orders.columns.id.identity).toBe('always')
    expect(live.tables.orders.columns.ref.identity).toBe('byDefault')
    expect(live.tables.orders.columns.total.generated).toMatchObject({ stored: true })
    await expect(checkDrift(live, v2, 'error')).resolves.toBeUndefined()
    expect(renderSchemaSource(live)).toContain('.generatedAlwaysAsIdentity()')
  }, 60_000)
})
