---
description: Make kick/db queries fast — relational reads instead of N+1 loops, selecting only what you need, indexes, keyset pagination, batch inserts, and finding slow queries.
---

# Performance

Most slow database code comes from a few patterns: one query per row, reading columns nobody uses, filtering on columns with no index, and paging deep with `offset`. This page shows the faster form of each, and how to find the queries that need it.

## One query for related rows

Looping over parents and querying children for each is the classic N+1 — one query, then one more per row:

```ts
// N + 1 queries
const users = await db.selectFrom('users').selectAll().execute()
for (const user of users) {
  user.posts = await db.selectFrom('posts').selectAll().where('authorId', '=', user.id).execute()
}
```

`db.query` loads the parents and their related rows in a single query, whatever the depth:

```ts
// 1 query
const users = await db.query.users.findMany({ with: { posts: true } })
```

Per-relation `where`, `orderBy` and `limit` stay inside that one query too — see [Relational Queries](../db-relational-query.md).

## Read only the columns you need

`db.query` returns every column of each table; it has no column selection. When a list shows a few fields of a wide table — skipping a long `body`, say — use the query builder and name them, joining what you need:

```ts
const rows = await db
  .selectFrom('posts')
  .innerJoin('users', 'users.id', 'posts.authorId')
  .select(['posts.id', 'posts.title', 'users.name as author'])
  .execute()
// { id: number; title: string; author: string }[]
```

The result type follows the selection, so a column you didn't select can't be read by mistake.

## Index what you filter, join and sort on

Declare indexes with the table, so migrations create them:

```ts
import { index, integer, serial, table, timestamp, varchar } from '@forinda/kickjs-db'

export const posts = table(
  'posts',
  {
    id: serial().primaryKey(),
    authorId: integer()
      .notNull()
      .references(() => users.id),
    title: varchar(200).notNull(),
    createdAt: timestamp().notNull().defaultNow(),
  },
  (t) => ({
    authorIdx: index('posts_author_idx').on(t.authorId),
    feedIdx: index('posts_feed_idx').on(t.createdAt, t.id),
  }),
)
```

- **Foreign key columns.** Postgres doesn't index them for you, and both `with` reads and `onDelete: 'cascade'` look rows up by them. MySQL adds one automatically if you don't.
- **Columns you filter on** in hot paths — `where('status', '=', …)`, `where('authorId', '=', …)`.
- **Your sort order**, with its tiebreaker — `(createdAt, id)` for a feed sorted newest first.

[Keys & Constraints](./constraints.md) has the syntax for unique and multi-column indexes.

## Paginate with keys, not offsets

`.offset(n)` makes the database read and discard `n` rows before returning a page, so deep pages get slower, and rows inserted between requests shift what each page shows. Keyset pagination — "the next 20 after this row" — costs the same on every page:

```ts
await db
  .selectFrom('posts')
  .select(['id', 'title', 'createdAt'])
  .where((eb) => eb(eb.refTuple('createdAt', 'id'), '<', eb.tuple(last.createdAt, last.id)))
  .orderBy('createdAt', 'desc')
  .orderBy('id', 'desc')
  .limit(20)
  .execute()
```

It needs the `(createdAt, id)` index above. The full recipe is in [Raw SQL & Recipes](./raw-sql.md#keyset-pagination). Offsets are fine for admin tables and other short lists where people jump to page 7.

## Insert many rows in one statement

```ts
await db
  .insertInto('posts')
  .values([
    { authorId: 1, title: 'First', status: 'live' },
    { authorId: 1, title: 'Second', status: 'draft' },
  ])
  .execute()
```

One statement, one round trip. Every row should have the same keys. On SQLite, a key missing from some rows is sent as `NULL` — there's no per-row `DEFAULT` there — so a `NOT NULL` column with a default fails with a NOT NULL violation instead of taking its default. Postgres and MySQL fill the default. Spell the value out in every row, or insert rows that differ separately.

## Count in the database

```ts
const { total } = await db
  .selectFrom('posts')
  .select((eb) => eb.fn.countAll<number>().as('total'))
  .where('authorId', '=', userId)
  .executeTakeFirstOrThrow()
```

`Number(total)` it before use: Postgres returns a count as a string, and SQLite as a number. Don't load rows just to take `.length`.

## One transaction for a batch, not one per row

Each `db.transaction()` costs a round trip to start and another to commit, and holds a connection while it runs. Wrap a batch in one transaction, not each row in its own:

```ts
await db.transaction(async () => {
  for (const row of rows) await importRow(row) // all in one transaction
})
```

Keep slow work that isn't SQL out of it — see [Connections and Pooling](./pooling.md#transactions-hold-a-connection).

## Finding slow queries

Turn on events and set a threshold, and the client tells you which queries are slow:

```ts
const db = createDbClient({
  schema,
  dialect: pgDialect({ pool }),
  slowQueryThresholdMs: 200,
})

db.on('slowQuery', ({ sql, durationMs }) => {
  logger.warn({ sql, durationMs }, 'slow query')
})
```

`query` events carry `durationMs` for every query, which is handy for counting queries per request while you hunt an N+1. In development, the [DevTools](../devtools.md) **Database** tab lists each query with its timing — pass the DevTools bus as `createDbClient({ bus })` ([Events and Plugins](./events-plugins.md)).

Then ask the database what it did with one, using raw SQL:

```ts
import { sql } from 'kysely'

// Postgres — runs the query and reports the real plan and timings
const plan = await sql`explain analyze select * from posts where "authorId" = ${userId}`.execute(
  db.qb,
)

// SQLite
const plan = await sql`explain query plan select * from posts where "authorId" = ${userId}`.execute(
  db.qb,
)
```

A sequential scan (`Seq Scan` on Postgres, `SCAN posts` on SQLite) on a large table where you expected an index lookup usually means a missing index.

## Related

- [Connections and Pooling](./pooling.md) — pool sizing, timeouts, transactions
- [Relational Queries](../db-relational-query.md) — `with`, nesting, per-relation filters
- [Raw SQL & Recipes](./raw-sql.md) — keyset pagination, aggregates, CTEs
- [Events and Plugins](./events-plugins.md) — every event and its payload
