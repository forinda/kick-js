# Raw SQL and Recipes

The query builder covers most queries; for everything else, write SQL. kick/db's client is built on [Kysely](https://kysely.dev), so Kysely's `sql` template and expression builder work as-is — values are always sent as parameters.

## The `sql` template

```ts
import { sql } from 'kysely'

const email = 'a@b.c'
const { rows } = await sql<{ name: string }>`select name from users where email = ${email}`.execute(
  db.qb,
)
```

`${email}` becomes a bound parameter (`$1` / `?`), never text spliced into the SQL. Run it against `db.qb`: inside a [transaction](./transactions#transactions-follow-the-call-chain), `db.qb` is that transaction, so raw SQL joins it like any other query.

### Inside the builder

A `sql` fragment goes anywhere an expression does:

```ts
await db
  .selectFrom('users')
  .select(['name', sql<string>`upper(email)`.as('shout')])
  .where(sql<boolean>`length(name) = ${3}`)
  .execute()
```

### Identifiers and literal SQL

| Helper               | Produces                  | Safe with user input?                   |
| -------------------- | ------------------------- | --------------------------------------- |
| `${value}`           | a bound parameter         | yes                                     |
| `sql.ref('email')`   | a quoted column reference | only from a fixed list of allowed names |
| `sql.table('users')` | a quoted table reference  | only from a fixed list of allowed names |
| `sql.lit(42)`        | an inline literal         | no — constants only                     |
| `sql.raw('…')`       | the string, verbatim      | **never**                               |

```ts
const sortable = ['email', 'createdAt'] as const
const column = (sortable as readonly string[]).includes(input) ? input : 'createdAt'
await sql`select * from users order by ${sql.ref(column)}`.execute(db.qb)
```

### See the SQL without running it

```ts
const { sql: text, parameters } = db.selectFrom('users').selectAll().where('id', '=', 7).compile()
// text: 'select * from "users" where "id" = ?'   parameters: [7]
```

## Searching with `LIKE`

Escape user input so `%` and `_` match literally:

```ts
import { likePattern } from '@forinda/kickjs-db'

// Postgres, MySQL
await db
  .selectFrom('users')
  .where('email', 'like', likePattern(search, 'contains'))
  .selectAll()
  .execute()

// SQLite has no default escape character — name it
await db
  .selectFrom('users')
  .where(sql<boolean>`email like ${likePattern(search, 'contains')} escape '\\'`)
  .selectAll()
  .execute()
```

`mode` is `'contains'` (default), `'startsWith'`, `'endsWith'` or `'exact'`; `escapeLike(input)` escapes without adding wildcards.

## Recipes

### Upsert

[`db.upsert()`](./queries.md#upsert-and-find-or-create) covers the usual case on every dialect. For more control — a conflict on a constraint name, a `DO NOTHING`, an update that depends on the old row — use the builder directly. Postgres and SQLite:

```ts
await db
  .insertInto('users')
  .values({ email, name })
  .onConflict((oc) => oc.column('email').doUpdateSet({ name: (eb) => eb.ref('excluded.name') }))
  .execute()
```

MySQL uses `onDuplicateKeyUpdate`:

```ts
await db
  .insertInto('users')
  .values({ email, name })
  .onDuplicateKeyUpdate({ name: sql`values(name)` })
  .execute()
```

### Increment a counter

```ts
await db
  .updateTable('users')
  .set((eb) => ({ logins: eb('logins', '+', 1) }))
  .where('id', '=', id)
  .execute()
```

In one statement, so concurrent increments don't lose updates.

### Keyset pagination

Faster than `offset` on large tables and stable while rows are inserted — page by the last row's sort key, with `id` as a tiebreaker:

```ts
function page(after?: { createdAt: Date; id: number }) {
  return db
    .selectFrom('posts')
    .select(['id', 'title', 'createdAt'])
    .$if(after !== undefined, (qb) =>
      qb.where((eb) =>
        eb(eb.refTuple('createdAt', 'id'), '<', eb.tuple(after!.createdAt, after!.id)),
      ),
    )
    .orderBy('createdAt', 'desc')
    .orderBy('id', 'desc')
    .limit(20)
    .execute()
}

const first = await page()
const second = await page(first.at(-1))
```

Pair it with an index on `(createdAt, id)`. For offset pages with totals, [`ctx.paginate`](./queries#pagination-with-ctx-paginate) does the bookkeeping.

### Count, exists, group by

```ts
const { n } = await db
  .selectFrom('posts')
  .select((eb) => eb.fn.countAll<number>().as('n'))
  .executeTakeFirstOrThrow()

// users who have written something
await db
  .selectFrom('users')
  .selectAll()
  .where((eb) =>
    eb.exists(eb.selectFrom('posts').select('id').whereRef('posts.authorId', '=', 'users.id')),
  )
  .execute()

// authors with at least two posts
await db
  .selectFrom('posts')
  .select(['authorId', (eb) => eb.fn.count<number>('id').as('posts')])
  .groupBy('authorId')
  .having((eb) => eb.fn.count('id'), '>=', 2)
  .execute()
```

### Optional filters

```ts
await db
  .selectFrom('users')
  .selectAll()
  .$if(name !== undefined, (qb) => qb.where('name', '=', name!))
  .$if(onlyActive, (qb) => qb.where('isActive', '=', true))
  .execute()
```

### Common table expressions

`db.with(name, query)` starts a query with a CTE:

```ts
await db
  .with('recent', (q) =>
    q.selectFrom('posts').select(['authorId', 'title']).where('createdAt', '>=', since),
  )
  .selectFrom('recent')
  .selectAll()
  .execute()
```

To reuse one, define it once with `db.cte()` and spread it in. It's typed from its query and works with any client of the same schema, transactions included:

```ts
const prolific = db.cte('prolific', (q) =>
  q
    .selectFrom('posts')
    .select(['authorId', (eb) => eb.fn.countAll<number>().as('n')])
    .groupBy('authorId')
    .having((eb) => eb.fn.countAll(), '>', 1),
)

await db.with(...prolific).selectFrom('prolific').innerJoin('users', 'users.id', 'prolific.authorId').selectAll().execute()
await db.with(...prolific).with(...another).selectFrom('prolific')…
```

`db.withRecursive` takes the same arguments for a recursive CTE. Both run on the primary, since a CTE may write.

### Union

```ts
await db
  .selectFrom('users')
  .select('name as label')
  .union(db.selectFrom('teams').select('name as label'))
  .execute()
```

`unionAll`, `intersect` and `except` work the same way.

### JSON (Postgres)

```ts
await db
  .selectFrom('events')
  .select(['id', sql<string>`data->>'kind'`.as('kind')])
  .where(sql<boolean>`data->'tags' ? ${'mobile'}`)
  .execute()
```

`->` returns JSON, `->>` text; `?` tests for a key or array element. Index the paths you filter on (`create index … using gin (data jsonb_path_ops)`).

Every example on this page except the MySQL upsert runs in kick/db's test suite, against SQLite or Postgres.

## Related

- [Queries](./queries) — the query builder, relational queries, transactions
- [Errors](./errors)
- [Kysely's recipes](https://kysely.dev/docs/category/recipes) — more patterns that apply unchanged
