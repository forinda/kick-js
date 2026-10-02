/**
 * Managed columns (D.10) on Postgres — plain updates, an upsert's update
 * branch, and soft delete in relational reads.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import pg from 'pg'
import { sql } from 'kysely'
import {
  createDbClient,
  diff,
  emitPg,
  extractSnapshot,
  integer,
  relations,
  serial,
  table,
  text,
  timestamptz,
  version,
  and,
  ilike,
  inArray,
  like,
} from '@forinda/kickjs-db'
import { pgDialect, pgSchema } from '@forinda/kickjs-db/pg'

const docs = table('docs', {
  id: serial().primaryKey(),
  slug: text().notNull().unique(),
  title: text().notNull(),
  version: version(),
  updatedAt: timestamptz().notNull().defaultNow().onUpdateNow(),
  deletedAt: timestamptz().softDelete(),
})
const comments = table('comments', {
  id: serial().primaryKey(),
  docId: integer()
    .notNull()
    .references(() => docs.id),
  body: text().notNull(),
  deletedAt: timestamptz().softDelete(),
})
const docRelations = relations(docs, ({ many }) => ({ comments: many(comments) }))
const commentRelations = relations(comments, ({ one }) => ({
  doc: one(docs, { fields: [comments.docId], references: [docs.id] }),
}))
const billing = pgSchema('billing')
const invoices = billing.table('invoices', {
  id: serial().primaryKey(),
  number: text().notNull().unique(),
  version: version(),
  updatedAt: timestamptz().notNull().defaultNow().onUpdateNow(),
  deletedAt: timestamptz().softDelete(),
})
const schema = { docs, comments, docRelations, commentRelations, invoices }

let container: StartedPostgreSqlContainer
let pool: pg.Pool

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start()
  pool = new pg.Pool({ connectionString: container.getConnectionUri() })
  pool.on('error', () => {})
  const empty = { version: 1 as const, dialect: 'postgres' as const, tables: {} }
  await pool.query('CREATE SCHEMA billing')
  await pool.query(emitPg(diff(empty, extractSnapshot(schema, 'postgres'))))
}, 120_000)

afterAll(async () => {
  await pool?.end()
  await container?.stop()
}, 60_000)

describe('managed columns on Postgres', () => {
  it('maintains updatedAt and version, in updates and upserts', async () => {
    const db = createDbClient({ schema, dialect: pgDialect({ pool }) })
    const first = await db.upsert('docs', { values: { slug: 'a', title: 'A' }, target: ['slug'] })
    expect(first.version).toBe(0)

    await new Promise((r) => setTimeout(r, 5))
    await db.updateTable('docs').set({ title: 'A2' }).where('id', '=', first.id).execute()
    const second = await db.upsert('docs', { values: { slug: 'a', title: 'A3' }, target: ['slug'] })
    expect(second.version).toBe(2)
    expect(second.updatedAt.getTime()).toBeGreaterThan(first.updatedAt.getTime())
  }, 30_000)

  it('db.query skips soft-deleted rows at every level, unless withDeleted', async () => {
    const db = createDbClient({ schema, dialect: pgDialect({ pool }) })
    const live = await db.upsert('docs', {
      values: { slug: 'live', title: 'Live' },
      target: ['slug'],
    })
    await db
      .insertInto('docs')
      .values({ slug: 'gone', title: 'Gone', deletedAt: new Date() })
      .execute()
    await db.insertInto('comments').values({ docId: live.id, body: 'kept' }).execute()
    await db
      .insertInto('comments')
      .values({ docId: live.id, body: 'hidden', deletedAt: new Date() })
      .execute()

    const doc = await db.query.docs.findFirst({
      where: (_d, eb) => eb('slug', '=', 'live'),
      with: { comments: true },
    })
    expect(doc!.comments.map((c) => c.body)).toEqual(['kept'])
    expect(await db.query.docs.findFirst({ where: (_d, eb) => eb('slug', '=', 'gone') })).toBeNull()
    expect(
      await db.query.docs.findFirst({
        where: (_d, eb) => eb('slug', '=', 'gone'),
        withDeleted: true,
      }),
    ).toMatchObject({ slug: 'gone' })
  }, 30_000)

  it('findManyAndCount totals what where matches, skipping soft-deleted rows and paging', async () => {
    const db = createDbClient({ schema, dialect: pgDialect({ pool }) })
    await db
      .insertInto('docs')
      .values([
        { slug: 'page-1', title: 'P1' },
        { slug: 'page-2', title: 'P2' },
        { slug: 'page-3', title: 'P3' },
        { slug: 'page-4', title: 'P4', deletedAt: new Date() },
      ])
      .execute()
    const { data: rows, total } = await db.query.docs.findManyAndCount({
      where: (_d, eb) => eb('slug', 'like', 'page-%'),
      orderBy: (_d, eb) => eb.ref('slug'),
      limit: 1,
      offset: 1,
    })
    // pg returns count(*) as a bigint string; it comes back a number.
    expect(total).toBe(3)
    expect(rows.map((r) => r.slug)).toEqual(['page-2'])
  }, 30_000)

  it('columns and extras shape relational reads at every level', async () => {
    const db = createDbClient({ schema, dialect: pgDialect({ pool }) })
    const doc = await db.upsert('docs', {
      values: { slug: 'shaped', title: 'Shaped' },
      target: ['slug'],
    })
    await db.insertInto('comments').values({ docId: doc.id, body: 'first' }).execute()
    const row = await db.query.docs.findFirst({
      where: (_d, eb) => eb('slug', '=', 'shaped'),
      columns: { slug: true },
      extras: { loud: () => sql<string>`upper(title)` },
      with: {
        comments: {
          columns: { body: true },
          extras: { size: () => sql<number>`length(body)` },
        },
      },
    })
    expect(row).toEqual({ slug: 'shaped', loud: 'SHAPED', comments: [{ body: 'first', size: 5 }] })
  }, 30_000)

  it('condition helpers and reusable CTEs run on Postgres', async () => {
    const db = createDbClient({ schema, dialect: pgDialect({ pool }) })
    await db.upsert('docs', { values: { slug: 'ops-a', title: 'Alpha' }, target: ['slug'] })
    await db.upsert('docs', { values: { slug: 'ops-b', title: 'Beta' }, target: ['slug'] })
    const rows = await db.query.docs.findMany({
      where: (d) => and(ilike(d.title, 'al%'), inArray(d.slug, ['ops-a', 'ops-b'])),
      columns: { slug: true },
    })
    expect(rows).toEqual([{ slug: 'ops-a' }])
    const ops = db.cte('ops', (q) =>
      q.selectFrom('docs').select('slug').where(like(docs.slug, 'ops-%')),
    )
    const n = await db
      .with(...ops)
      .selectFrom('ops')
      .select((eb) => eb.fn.countAll<string>().as('n'))
      .executeTakeFirstOrThrow()
    expect(Number(n.n)).toBe(2)
  }, 30_000)

  it('works for a table in a named schema', async () => {
    const db = createDbClient({ schema, dialect: pgDialect({ pool }) })
    const first = await db.upsert('billing.invoices', {
      values: { number: 'A-1' },
      target: ['number'],
    })
    await db
      .updateTable('billing.invoices')
      .set({ number: 'A-1' })
      .where('id', '=', first.id)
      .execute()
    const again = await db.upsert('billing.invoices', {
      values: { number: 'A-1' },
      target: ['number'],
    })
    expect(again.version).toBe(2)

    await db
      .insertInto('billing.invoices')
      .values({ number: 'VOID', deletedAt: new Date() })
      .execute()
    const listed = await db.query['billing.invoices'].findMany({
      orderBy: (_i, eb) => eb.ref('id'),
    })
    expect(listed.map((i) => i.number)).toEqual(['A-1'])
  }, 30_000)
})
