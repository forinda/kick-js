/**
 * D.21 `.colName()`: a column whose database name isn't its key — in
 * migrations, queries, relational reads and results, with and without casing.
 */
import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import {
  createDbClient,
  diff,
  emitSqlite,
  eq,
  extractSnapshot,
  integer,
  relations,
  renderSchemaSource,
  serial,
  sql,
  table,
  text,
  timestamp,
} from '@forinda/kickjs-db'
import { removeCasing } from '../../src/snapshot/casing'
import { sqliteDialect } from '@forinda/kickjs-db/sqlite'

const users = table('users', {
  id: serial().primaryKey(),
  email: text().notNull().unique().colName('EMAIL_ADDR'),
  fullName: text().colName('FULL_NM'),
  updatedAt: timestamp().notNull().defaultNow().onUpdateNow().colName('MODIFIED'),
})
// Same key as users.email, no rename: resolution has to go by table.
const posts = table('posts', {
  id: serial().primaryKey(),
  authorId: integer()
    .notNull()
    .references(() => users.id)
    .colName('AUTHOR'),
  email: text(),
  title: text().notNull(),
})
const userRelations = relations(users, ({ many }) => ({ posts: many(posts) }))
const postRelations = relations(posts, ({ one }) => ({
  author: one(users, { fields: [posts.authorId], references: [users.id] }),
}))
const schema = { users, posts, userRelations, postRelations }

function make(casing?: 'snake_case') {
  const database = new Database(':memory:')
  const empty = { version: 1 as const, dialect: 'sqlite' as const, tables: {} }
  const target = extractSnapshot(schema, 'sqlite', { casing })
  database.exec(emitSqlite(diff(empty, target), { from: empty, to: target }))
  const db = createDbClient({ schema, dialect: sqliteDialect({ database }), casing })
  const columns = (t: string) =>
    (database.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).map((c) => c.name)
  return { database, db, target, columns }
}

for (const casing of [undefined, 'snake_case'] as const) {
  describe(`.colName() — casing: ${casing ?? 'none'}`, () => {
    it('names the columns, and what derives from them, in migrations', () => {
      const { target, columns } = make(casing)
      expect(columns('users')).toEqual(['id', 'EMAIL_ADDR', 'FULL_NM', 'MODIFIED'])
      expect(columns('posts')).toEqual(['id', 'AUTHOR', 'email', 'title'])
      expect(target.tables.users!.indexes[0]!.name).toBe('users_EMAIL_ADDR_unique')
      expect(target.tables.posts!.foreignKeys[0]).toMatchObject({
        name: 'posts_AUTHOR_fk',
        columns: ['AUTHOR'],
        refColumns: ['id'],
      })
    })

    it('reads and writes by key', async () => {
      const { db, database } = make(casing)
      const ada = await db
        .insertInto('users')
        .values({ email: 'ada@x.io', fullName: 'Ada' })
        .returningAll()
        .executeTakeFirstOrThrow()
      expect(ada).toMatchObject({ id: 1, email: 'ada@x.io', fullName: 'Ada' })
      expect(ada.updatedAt).toBeInstanceOf(Date)
      expect(database.prepare('select EMAIL_ADDR, FULL_NM from users').get()).toEqual({
        EMAIL_ADDR: 'ada@x.io',
        FULL_NM: 'Ada',
      })

      await db
        .insertInto('posts')
        .values({ authorId: ada.id, email: 'post@x.io', title: 'Hi' })
        .execute()
      // Selected by key, filtered by key, both tables' `email` kept apart.
      const joined = await db
        .selectFrom('posts')
        .innerJoin('users', 'users.id', 'posts.authorId')
        .select(['users.email', 'posts.email as postEmail', 'posts.authorId'])
        .where('users.email', '=', 'ada@x.io')
        .execute()
      expect(joined).toEqual([{ email: 'ada@x.io', postEmail: 'post@x.io', authorId: 1 }])
      // Unqualified: only users is in scope.
      expect(
        await db.selectFrom('users').select('fullName').where('email', '=', 'ada@x.io').execute(),
      ).toEqual([{ fullName: 'Ada' }])
      // select * rows come back by key.
      expect(
        Object.keys(await db.selectFrom('users').selectAll().executeTakeFirstOrThrow()),
      ).toEqual(['id', 'email', 'fullName', 'updatedAt'])
      // Operators take the column objects.
      expect(
        await db.selectFrom('users').select('id').where(eq(users.email, 'ada@x.io')).execute(),
      ).toEqual([{ id: 1 }])
    })

    it("leaves a name the query aliases itself, even one that's a column's database name", async () => {
      const { db } = make(casing)
      await db.insertInto('users').values({ email: 'a@x.io', fullName: 'A' }).execute()
      const aliased = await db
        .selectFrom('users')
        .select(sql<string>`'mine'`.as('EMAIL_ADDR'))
        .executeTakeFirstOrThrow()
      // Not turned into the key (casing converts an alias on its own, as always).
      expect(Object.keys(aliased)).toEqual([casing ? 'emailAddr' : 'EMAIL_ADDR'])
      expect(aliased).not.toHaveProperty('email')
      const both = await db
        .selectFrom('users')
        .selectAll()
        .select(sql<string>`'mine'`.as('FULL_NM'))
        .executeTakeFirstOrThrow()
      // Beside `*`: the alias stays as written. (Aliasing a column's own database
      // name next to `*` makes two outputs with one name — the driver keeps one.)
      expect(both).toMatchObject({ email: 'a@x.io', [casing ? 'fullNm' : 'FULL_NM']: 'mine' })
    })

    it('updates, upserts and deletes by key, managed columns included', async () => {
      const { db, database } = make(casing)
      await db.insertInto('users').values({ email: 'a@x.io', fullName: 'A' }).execute()
      database.exec(`update users set MODIFIED = '2000-01-01 00:00:00.000'`)
      await db.updateTable('users').set({ fullName: 'B' }).where('email', '=', 'a@x.io').execute()
      const row = database.prepare('select FULL_NM, MODIFIED from users').get() as Record<
        string,
        string
      >
      expect(row.FULL_NM).toBe('B')
      expect(row.MODIFIED).not.toBe('2000-01-01 00:00:00.000') // onUpdateNow reached MODIFIED

      const up = await db.upsert('users', {
        values: { email: 'a@x.io', fullName: 'C' },
        target: ['email'],
      })
      expect(up).toMatchObject({ email: 'a@x.io', fullName: 'C' })
      const { created } = await db.findOrCreate('users', { where: { email: 'a@x.io' } })
      expect(created).toBe(false)

      await db.deleteFrom('users').where('email', '=', 'a@x.io').execute()
      expect(database.prepare('select count(*) n from users').get()).toEqual({ n: 0 })
    })

    it('db.query nests by key', async () => {
      const { db } = make(casing)
      const ada = await db
        .insertInto('users')
        .values({ email: 'ada@x.io', fullName: 'Ada' })
        .returning('id')
        .executeTakeFirstOrThrow()
      await db.insertInto('posts').values({ authorId: ada.id, email: null, title: 'One' }).execute()
      const found = await db.query.users.findMany({
        columns: { email: true, fullName: true },
        with: { posts: { columns: { title: true, authorId: true } } },
        where: (u, eb) => eb('email', '=', 'ada@x.io'),
      })
      expect(found).toEqual([
        { email: 'ada@x.io', fullName: 'Ada', posts: [{ title: 'One', authorId: ada.id }] },
      ])
      const post = await db.query.posts.findFirst({ with: { author: true } })
      expect(post!.author).toMatchObject({ email: 'ada@x.io', fullName: 'Ada' })
    })
  })
}

describe('introspection', () => {
  it('writes .colName() where casing would not give the name back', () => {
    const { target } = make('snake_case')
    const source = renderSchemaSource(removeCasing(target))
    expect(source).toContain(`emailAddr: text().notNull().unique().colName('EMAIL_ADDR')`)
    expect(source).toContain(`title: text().notNull(),`)
  })
})
