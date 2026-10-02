# Queries

`KickDbClient` is a thin wrapper over a [Kysely](https://kysely.dev) instance. It exposes Kysely's typed query builder directly — `selectFrom`, `insertInto`, `updateTable`, `deleteFrom` — plus the relational `db.query` layer.

All examples assume an injected client:

```ts
import { Service, Inject } from '@forinda/kickjs'
import { DB_PRIMARY, type KickDbClient } from '@forinda/kickjs-db'

@Service()
export class UsersService {
  @Inject(DB_PRIMARY) private db!: KickDbClient
  // ...
}
```

## The query builder

### Select

```ts
// One row, or undefined
await this.db.selectFrom('users').selectAll().where('email', '=', 'a@b.com').executeTakeFirst()

// One row, or throw
await this.db
  .selectFrom('users')
  .select(['id', 'email'])
  .where('id', '=', id)
  .executeTakeFirstOrThrow()

// Many rows
await this.db
  .selectFrom('posts')
  .selectAll()
  .where('authorId', '=', userId)
  .orderBy('createdAt', 'desc')
  .limit(20)
  .execute()
```

Column names, operators, and the returned row shape are all checked against your schema — `row.email` is `string`, selecting a column that doesn't exist is a compile error.

### Insert

Generated columns (`serial()`, `uuid().defaultRandom()`, `timestamp().defaultNow()`, anything with `.default(...)`) are optional on insert:

```ts
await this.db
  .insertInto('users')
  .values({ email: 'a@b.com', name: 'Ada' }) // id + createdAt omitted
  .returningAll()
  .executeTakeFirstOrThrow()
```

### Update & delete

```ts
await this.db
  .updateTable('users')
  .set({ name: 'Grace' })
  .where('id', '=', id)
  .returningAll()
  .executeTakeFirst()

await this.db.deleteFrom('posts').where('id', '=', id).execute()
```

::: tip The raw Kysely instance
For anything not surfaced on the wrapper, `this.db.qb` is the underlying `Kysely<DB>`. You rarely need it — `selectFrom` / `insertInto` / `updateTable` / `deleteFrom` cover the common surface.
:::

## Upsert and find-or-create

`upsert` inserts a row, or updates the one whose key already exists — one statement, safe under concurrency:

```ts
const user = await this.db.upsert('users', {
  values: { email, name },
  target: ['email'], // the unique key that decides insert vs update
})
// → the row as stored, inserted or updated
```

| Option   | What it does                                                                                                           |
| -------- | ---------------------------------------------------------------------------------------------------------------------- |
| `values` | a row, or an array of rows — an array returns an array                                                                 |
| `target` | the unique (or primary) key columns whose conflict means "update instead"                                              |
| `update` | column names that take the incoming value (default: every inserted column outside `target`), or fixed `{ col: value }` |
| `where`  | the predicate of a partial unique index `target` refers to — Postgres and SQLite                                       |

```ts
// Count a visit: insert with 1, or add to what's there.
await this.db.upsert('page_views', {
  values: { path, views: 1 },
  target: ['path'],
  update: { views: sql`page_views.views + 1` },
})
```

`findOrCreate` returns the row matching `where`, creating it from `where` + `create` when there's none:

```ts
const { row, created } = await this.db.findOrCreate('tags', {
  where: { name: 'urgent' },
  create: { color: 'red' },
})
```

It's race-safe: when two requests miss at the same moment, one inserts and the other hits the unique key, catches the `UniqueViolationError` and reads the winner's row — both get the same row, `created` is `true` for one. `where` should be a unique key; a conflict on a different key (the row can't be created and none matches `where`) is thrown. Inside a transaction, the insert runs in a savepoint, so a lost race doesn't abort it on Postgres.

Per dialect:

- **Postgres and SQLite** compile to `INSERT … ON CONFLICT (target) DO UPDATE … RETURNING *`.
- **MySQL** compiles to `INSERT … ON DUPLICATE KEY UPDATE` and reads the rows back by their `target` values — MySQL has no `RETURNING`. It also ignores `target` when deciding: a conflict on any unique key updates. `where` isn't supported.
- **A partial index's `where`** must be written as the index's own predicate, with literals — ``where: () => sql`active` `` for `… WHERE active` — because the database matches it to the index, and a bound parameter can't be matched.

## Relational queries

`db.query.<table>.findMany` / `findFirst` / `findUnique` load rows together with their related rows in one query, driven by the `relations()` in your schema:

```ts
await this.db.query.users.findMany({
  where: (u, eb) => eb('isActive', '=', true),
  with: { posts: { limit: 5 } },
  signal: ctx.signal,
})
// → Array<{ id; email; …; posts: Post[] }>
```

The options, nesting, self-references, dialect notes and cancellation are on [Relational Queries](../db-relational-query).

## Pagination with `ctx.paginate`

KickJS's HTTP layer already parses `page` / `limit` / filters / sort off the query string. `ctx.paginate()` wraps a fetcher that returns `{ data, total }` and emits a standardized paginated response. Use `parsed.pagination.limit` / `parsed.pagination.offset` to bound the query:

```ts
import { Controller, Get, type RequestContext } from '@forinda/kickjs'

@Controller()
export class UsersController {
  @Inject(DB_PRIMARY) private db!: KickDbClient

  @Get('/')
  list(ctx: RequestContext) {
    return ctx.paginate(
      async (parsed) => {
        const data = await this.db
          .selectFrom('users')
          .selectAll()
          .limit(parsed.pagination.limit)
          .offset(parsed.pagination.offset)
          .execute()

        const totalRow = await this.db
          .selectFrom('users')
          .select((eb) => eb.fn.countAll<number>().as('count'))
          .executeTakeFirstOrThrow()

        return { data, total: Number(totalRow.count) }
      },
      { sortable: ['createdAt'], filterable: ['name'] },
    )
  }
}
```

The response includes `meta: { page, limit, total, totalPages, hasNext, hasPrev }`. See [Query Parsing](../query-parsing) for the full `ctx.qs` / `ctx.paginate` surface, and [Repositories](./repositories) for wrapping these queries behind a repository interface.

## More

- [Transactions](./transactions) — commit/rollback, savepoints, call-chain joining, `afterCommit`, retry
- [Raw SQL & Recipes](./raw-sql) — the `sql` template, upsert, keyset pagination, aggregates, CTEs
- [Errors](./errors) — typed errors and how to handle them
- [Events and Plugins](./events-plugins) — lifecycle events, `safeNullComparison()`
- [Extensions](../db-extensions) — `$extends` per-table methods
