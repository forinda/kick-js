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

## Condition helpers

Besides Kysely's `where('email', '=', x)` and `eb(…)`, conditions can be built with standalone helpers. Their operands are a table's columns (`users.email`) or plain values, and they return an expression, so they work in `.where()`, a join's `.on()`, `having` and `db.query`:

```ts
import { and, eq, gt, inArray, isNull, like, or } from '@forinda/kickjs-db'

await db
  .selectFrom('users')
  .selectAll()
  .where(and(eq(users.role, 'admin'), or(isNull(users.deletedAt), gt(users.lastSeen, cutoff))))
  .execute()

// In db.query, use the row argument: it refers to the right table at every level.
await db.query.users.findMany({
  where: (u) => inArray(u.id, ids),
  with: { posts: { where: (p) => like(p.title, 'Draft%') } },
})
```

| Helper                                    | SQL                             |
| ----------------------------------------- | ------------------------------- |
| `eq`, `ne`, `gt`, `gte`, `lt`, `lte`      | `=`, `<>`, `>`, `>=`, `<`, `<=` |
| `like`, `notLike`, `ilike` (Postgres)     | `LIKE`, `NOT LIKE`, `ILIKE`     |
| `isNull`, `isNotNull`                     | `IS NULL`, `IS NOT NULL`        |
| `inArray`, `notInArray`                   | `IN (…)`, `NOT IN (…)`          |
| `between(col, low, high)`                 | `BETWEEN … AND …`               |
| `and(…)`, `or(…)`, `not(…)`               | grouped in parentheses          |
| `exists(subquery)`, `notExists(subquery)` | `EXISTS (…)`                    |

- **Operands are type-checked.** `eq(users.name, 1)` doesn't compile. A Kysely expression (`eb.ref('email')`, `` sql`lower(email)` ``, `sql.ref('users.id')`) is accepted wherever a column is.
- **Edge cases stay valid SQL.** `and()` and `or()` skip `undefined`, so a filter can be built conditionally: `and(eq(t.a, a), b ? eq(t.b, b) : undefined)`. With nothing left, `and()` matches every row and `or()` matches none. An empty `inArray` matches nothing, and an empty `notInArray` matches everything.
- **Use the right column reference.** Inside `db.query`, use the row argument rather than `users.email`. The relational reader aliases each table (`users_0`), so a reference to the bare table name wouldn't resolve.
- **Escape `like` patterns.** Pass user input through `escapeLike()` first ([Raw SQL](./raw-sql.md)).

### A table twice: `alias()`

`alias(table, name)` gives a second name for a table, for self-joins. Its columns work with the helpers, and `$from` is what `selectFrom` and the joins take:

```ts
import { alias, eq } from '@forinda/kickjs-db'

const manager = alias(users, 'manager')

await db
  .selectFrom('users')
  .innerJoin(manager.$from, (j) => j.on(eq(manager.id, users.managerId)))
  .select(['users.name', 'manager.name as managerName'])
  .execute()
```

Reusable CTEs are under [Raw SQL & Recipes](./raw-sql.md#common-table-expressions).

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

It's race-safe: when two requests miss at the same moment, one inserts and the other hits the unique key, catches the `UniqueViolationError` and reads the winner's row — both get the same row, `created` is `true` for one. That holds outside a transaction and inside a `READ COMMITTED` one (Postgres's default). Inside a `REPEATABLE READ` or `serializable` transaction — MySQL's default — the re-read sees the transaction's snapshot, which can't contain the winner's row, so the `UniqueViolationError` is rethrown; catch it and run the whole transaction again. `where` should be a unique key; a conflict on a different key (the row can't be created and none matches `where`) is thrown. Inside a transaction, the insert runs in a savepoint, so a lost race doesn't abort it on Postgres.

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

KickJS's HTTP layer already parses `page` / `limit` / filters / sort off the query string. `ctx.paginate()` wraps a fetcher that returns `{ data, total }` and emits a standardized paginated response. Use `parsed.pagination.limit` / `parsed.pagination.offset` to bound the query. `findManyAndCount` returns that shape, the page plus the total before paging:

```ts
import { Controller, Get, type RequestContext } from '@forinda/kickjs'

@Controller()
export class UsersController {
  @Inject(DB_PRIMARY) private db!: KickDbClient

  @Get('/')
  list(ctx: RequestContext) {
    return ctx.paginate((parsed) =>
      this.db.query.users.findManyAndCount({
        limit: parsed.pagination.limit,
        offset: parsed.pagination.offset,
      }),
    )
  }
}
```

To honour `?filter=` and `?sort=` too, pass a field config as the second argument and map `parsed.filters` / `parsed.sort` into `where` / `orderBy`; the same `where` then also bounds `total`. With the query builder instead, run the page and a `count(*)` with the same `where`, and return `{ data, total: Number(count) }`. The response includes `meta: { page, limit, total, totalPages, hasNext, hasPrev }`. See [Query Parsing](../query-parsing) for the full `ctx.qs` / `ctx.paginate` surface, and [Repositories](./repositories) for wrapping these queries behind a repository interface.

## More

- [Transactions](./transactions) — commit/rollback, savepoints, call-chain joining, `afterCommit`, retry
- [Raw SQL & Recipes](./raw-sql) — the `sql` template, upsert, keyset pagination, aggregates, CTEs
- [Errors](./errors) — typed errors and how to handle them
- [Events and Plugins](./events-plugins) — lifecycle events, `safeNullComparison()`
- [Extensions](../db-extensions) — `$extends` per-table methods
