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
  serial,
  table,
  text,
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

  it('joins mixed-case columns with ||, and refuses concat_ws as not immutable', async () => {
    const people = (fullName: string) =>
      table('people', {
        id: serial().primaryKey(),
        firstName: text().notNull(),
        lastName: text(),
        fullName: text().generatedAlwaysAs(fullName),
      })
    const empty = { version: 1 as const, dialect: 'postgres' as const, tables: {} }
    const refused = extractSnapshot(
      { people: people(`concat_ws(' ', "firstName", "lastName")`) },
      'postgres',
    )
    await expect(pool.query(emitPg(diff(empty, refused)))).rejects.toThrow(/immutable/)

    const target = extractSnapshot(
      { people: people(`"firstName" || coalesce(' ' || "lastName", '')`) },
      'postgres',
    )
    await pool.query(emitPg(diff(empty, target)))
    await pool.query(
      `INSERT INTO people ("firstName", "lastName") VALUES ('Ada', 'Lovelace'), ('Cher', NULL)`,
    )
    const { rows } = await pool.query('SELECT "fullName" FROM people ORDER BY id')
    expect(rows.map((r) => r.fullName)).toEqual(['Ada Lovelace', 'Cher'])
    const live = await introspectPg(pool)
    await expect(
      checkDrift({ ...live, tables: { people: live.tables.people } }, target, 'error'),
    ).resolves.toBeUndefined()
  }, 60_000)
})
