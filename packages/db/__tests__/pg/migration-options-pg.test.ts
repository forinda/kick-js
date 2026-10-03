/** D.22 on Postgres: read-only transactions, and a schema-qualified migrations table. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import pg from 'pg'
import {
  createDbClient,
  diff,
  emitPg,
  extractSnapshot,
  generate,
  jsonb,
  migrateLatest,
  serial,
  table,
  text,
} from '@forinda/kickjs-db'
import { pgAdapter, pgDialect, pgSchema } from '@forinda/kickjs-db/pg'

const here = path.dirname(fileURLToPath(import.meta.url))
const notes = table('notes', { id: serial().primaryKey(), body: text() })
let container: StartedPostgreSqlContainer
let pool: pg.Pool
let dir: string

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start()
  pool = new pg.Pool({ connectionString: container.getConnectionUri() })
  pool.on('error', () => {})
  dir = await mkdtemp(path.join(here, '../fixtures/tmp-migration-options-pg-'))
}, 120_000)

afterAll(async () => {
  await pool?.end()
  await container?.stop()
  if (dir) await rm(dir, { recursive: true, force: true })
}, 60_000)

describe('migration and transaction options on Postgres', () => {
  it('a read-only transaction reads but refuses writes', async () => {
    await pool.query(
      emitPg(
        diff(
          { version: 1, dialect: 'postgres', tables: {} },
          extractSnapshot({ notes }, 'postgres'),
        ),
      ),
    )
    const db = createDbClient({ schema: { notes }, dialect: pgDialect({ pool }) })
    await db.insertInto('notes').values({ body: 'one' }).execute()
    const read = await db.transaction({ readOnly: true }, () =>
      db.selectFrom('notes').select('body').execute(),
    )
    expect(read).toEqual([{ body: 'one' }])
    await expect(
      db.transaction({ readOnly: true }, () =>
        db.insertInto('notes').values({ body: 'x' }).execute(),
      ),
    ).rejects.toThrow(/read-only transaction/)
  }, 30_000)

  it('a read-only request inside a writable transaction is refused, inside a read-only one allowed', async () => {
    const db = createDbClient({ schema: { notes }, dialect: pgDialect({ pool }) })
    await expect(
      db.transaction(() =>
        db.transaction({ readOnly: true }, () => db.selectFrom('notes').selectAll().execute()),
      ),
    ).rejects.toThrow(/inside a writable transaction can't be read-only/)
    await expect(
      db.transaction({ readOnly: true }, () =>
        db.transaction({ readOnly: true, nested: 'savepoint' }, () =>
          db.selectFrom('notes').selectAll().execute(),
        ),
      ),
    ).resolves.toBeDefined()
    // A separate transaction can be read-only whatever is open.
    await expect(
      db.transaction(() =>
        db.transaction({ readOnly: true, nested: 'separate' }, () =>
          db.selectFrom('notes').selectAll().execute(),
        ),
      ),
    ).resolves.toBeDefined()
  }, 30_000)

  it('casing converts a schema name like the query does, and leaves JSON values alone', async () => {
    const app = pgSchema('billingApp')
    const invoices = app.table('invoices', {
      id: serial().primaryKey(),
      lineItems: jsonb<{ unit_price: number }[]>(),
    })
    const target = extractSnapshot({ invoices }, 'postgres', { casing: 'snake_case' })
    expect(target.schemas).toEqual(['billing_app'])
    await pool.query(emitPg(diff({ version: 1, dialect: 'postgres', tables: {} }, target)))
    const db = createDbClient({
      schema: { invoices },
      dialect: pgDialect({ pool }),
      casing: 'snake_case',
    })
    await db
      .insertInto('billingApp.invoices')
      .values({ lineItems: JSON.stringify([{ unit_price: 5 }]) as never })
      .execute()
    const row = await db.selectFrom('billingApp.invoices').selectAll().executeTakeFirstOrThrow()
    expect(row.lineItems).toEqual([{ unit_price: 5 }])
  }, 30_000)

  it('records migrations in a table in another schema, created if missing', async () => {
    await writeFile(
      path.join(dir, 'schema.ts'),
      `import { serial, table } from '@forinda/kickjs-db'\nexport const things = table('things', { id: serial().primaryKey() })`,
    )
    const migrationsDir = path.join(dir, 'migrations')
    await generate({
      name: 'init',
      config: { schemaPath: path.join(dir, 'schema.ts'), migrationsDir, dialect: 'postgres' },
      cwd: dir,
      now: () => new Date(Date.UTC(2026, 9, 3)),
    })
    const adapter = pgAdapter({ pool, migrationsTable: 'meta.schema_history' })
    const opts = { adapter, migrationsDir, requireReviewed: false, driftCheck: 'ignore' as const }
    expect((await migrateLatest(opts)).applied).toHaveLength(1)
    const { rows } = await pool.query('SELECT name FROM meta.schema_history')
    expect(rows).toEqual([{ name: 'init' }])
    expect((await migrateLatest(opts)).applied).toEqual([])
    // A user table with the same bare name in the introspected schema is still reported.
    await pool.query('CREATE TABLE public.schema_history (id int)')
    expect(Object.keys((await adapter.introspect()).tables)).toContain('schema_history')
  }, 30_000)
})
