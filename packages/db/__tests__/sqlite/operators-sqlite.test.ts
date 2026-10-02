/** Condition helpers, `alias()` and reusable CTEs on SQLite. */
import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { sql } from 'kysely'
import {
  alias,
  and,
  between,
  createDbClient,
  diff,
  emitSqlite,
  eq,
  exists,
  extractSnapshot,
  gt,
  inArray,
  integer,
  isNull,
  like,
  ne,
  not,
  notInArray,
  or,
  relations,
  serial,
  table,
  text,
} from '@forinda/kickjs-db'
import { sqliteDialect } from '@forinda/kickjs-db/sqlite'

const users = table('users', {
  id: serial().primaryKey(),
  name: text().notNull(),
  managerId: integer(),
})
const posts = table('posts', {
  id: serial().primaryKey(),
  authorId: integer()
    .notNull()
    .references(() => users.id),
  title: text().notNull(),
})
const userRelations = relations(users, ({ many }) => ({ posts: many(posts) }))
const postRelations = relations(posts, ({ one }) => ({
  author: one(users, { fields: [posts.authorId], references: [users.id] }),
}))
const schema = { users, posts, userRelations, postRelations }

async function make() {
  const database = new Database(':memory:')
  const empty = { version: 1 as const, dialect: 'sqlite' as const, tables: {} }
  const target = extractSnapshot(schema, 'sqlite')
  database.exec(emitSqlite(diff(empty, target), { from: empty, to: target }))
  const db = createDbClient({ schema, dialect: sqliteDialect({ database }) })
  await db
    .insertInto('users')
    .values([
      { name: 'Grace', managerId: null },
      { name: 'Ada', managerId: 1 },
      { name: 'Linus', managerId: 1 },
    ])
    .execute()
  await db
    .insertInto('posts')
    .values([
      { authorId: 2, title: 'Engines' },
      { authorId: 2, title: 'Notes' },
      { authorId: 3, title: 'Kernels' },
    ])
    .execute()
  return db
}

const names = (rows: { name: string }[]) => rows.map((r) => r.name)

describe('condition helpers', () => {
  it('work in .where() with schema columns', async () => {
    const db = await make()
    const q = () => db.selectFrom('users').select('name').orderBy('id')
    expect(names(await q().where(eq(users.name, 'Ada')).execute())).toEqual(['Ada'])
    expect(
      names(
        await q()
          .where(and(gt(users.id, 1), ne(users.name, 'Ada')))
          .execute(),
      ),
    ).toEqual(['Linus'])
    expect(
      names(
        await q()
          .where(or(isNull(users.managerId), like(users.name, 'L%')))
          .execute(),
      ),
    ).toEqual(['Grace', 'Linus'])
    expect(
      names(
        await q()
          .where(inArray(users.id, [1, 3]))
          .execute(),
      ),
    ).toEqual(['Grace', 'Linus'])
    expect(
      names(
        await q()
          .where(not(between(users.id, 1, 2)))
          .execute(),
      ),
    ).toEqual(['Linus'])
    // Empty lists, and undefined in and(), stay valid SQL.
    expect(await q().where(inArray(users.id, [])).execute()).toEqual([])
    expect(await q().where(notInArray(users.id, [])).execute()).toHaveLength(3)
    expect(
      await q()
        .where(and(undefined, eq(users.name, 'Grace')))
        .execute(),
    ).toHaveLength(1)
    // A subquery.
    const authors = await q()
      .where(
        exists(
          db
            .selectFrom('posts')
            .select('posts.id')
            .where(eq(posts.authorId, sql.ref('users.id'))),
        ),
      )
      .execute()
    expect(names(authors)).toEqual(['Ada', 'Linus'])
  })

  it("work in db.query's where, with the row argument, at every level", async () => {
    const db = await make()
    const rows = await db.query.users.findMany({
      where: (u) => inArray(u.name, ['Ada', 'Linus']),
      orderBy: (_u, eb) => eb.ref('id'),
      with: { posts: { where: (p) => like(p.title, 'N%') } },
    })
    expect(rows.map((r) => [r.name, r.posts.map((p) => p.title)])).toEqual([
      ['Ada', ['Notes']],
      ['Linus', []],
    ])
  })
})

describe('alias()', () => {
  it('reads a table twice in a self-join', async () => {
    const db = await make()
    const manager = alias(users, 'manager')
    const rows = await db
      .selectFrom('users')
      .innerJoin(manager.$from, (j) => j.on(eq(manager.id, users.managerId)))
      .select(['users.name', 'manager.name as managerName'])
      .orderBy('users.id')
      .execute()
    expect(rows).toEqual([
      { name: 'Ada', managerName: 'Grace' },
      { name: 'Linus', managerName: 'Grace' },
    ])
  })
})

describe('reusable CTEs', () => {
  it('define once, use in several queries', async () => {
    const db = await make()
    const prolific = db.cte('prolific', (q) =>
      q
        .selectFrom('posts')
        .select(['authorId', (eb) => eb.fn.countAll<number>().as('n')])
        .groupBy('authorId')
        .having((eb) => eb.fn.countAll(), '>', 1),
    )
    const top = await db
      .with(...prolific)
      .selectFrom('prolific')
      .innerJoin('users', 'users.id', 'prolific.authorId')
      .select(['users.name', 'prolific.n'])
      .execute()
    expect(top).toEqual([{ name: 'Ada', n: 2 }])

    const count = await db
      .with(...prolific)
      .selectFrom('prolific')
      .select((eb) => eb.fn.countAll<number>().as('c'))
      .executeTakeFirstOrThrow()
    expect(count.c).toBe(1)
  })
})
