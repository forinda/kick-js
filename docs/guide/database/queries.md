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
