# Queries

`KickDbClient` is a thin wrapper over a [Kysely](https://kysely.dev) instance. It exposes Kysely's typed query builder directly — `selectFrom`, `insertInto`, `updateTable`, `deleteFrom` — plus a relational `db.query` layer, transactions, savepoints, lifecycle events, and `$extends`.

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

The `db.query` namespace eager-loads related rows in a single query (JSON aggregation per dialect — no N+1). It is driven by the `relations()` you declared in the schema (see [Schema → Relations](./schema#relations-for-db-query)).

```ts
// All users, each with their posts array
await this.db.query.users.findMany({
  with: { posts: true },
})
// → Array<{ id; email; ...; posts: Post[] }>

// Filtered, ordered, with a nested filtered relation
await this.db.query.users.findMany({
  where: (u, eb) => eb('isActive', '=', true),
  orderBy: (u, eb) => eb.ref('createdAt'),
  limit: 20,
  with: {
    posts: {
      where: (p, eb) => eb('publishedAt', 'is not', null),
      limit: 5,
    },
  },
})
```

Three read methods are available:

- `findMany(options?)` → `Row[]`
- `findFirst(options?)` → `Row | null`
- `findUnique(options)` → `Row | null`

The options bag:

| Field      | Type                                        | Notes                                                       |
| ---------- | ------------------------------------------- | ----------------------------------------------------------- |
| `where`    | `(table, eb) => Expression`                 | `eb` is Kysely's expression builder — `eb('col', '=', v)`   |
| `orderBy`  | `(table, eb) => Expression \| Expression[]` | use `eb.ref('col')`                                         |
| `limit`    | `number`                                    |                                                             |
| `offset`   | `number`                                    |                                                             |
| `with`     | `{ [relation]: true \| FindManyOptions }`   | `true` eager-loads; an object form filters the relation     |
| `maxDepth` | `number`                                    | depth guard (default 5); throws `RelationalQueryDepthError` |
| `signal`   | `AbortSignal`                               | cancels the in-flight query — bind to `ctx.signal`          |

The `with` keys are constrained to the relations declared for that table; a relation slot resolves to `Related | null` for `one` and `Related[]` for `many`.

::: warning Dialect support
The relational query layer requires JSON aggregation. PostgreSQL is fully supported. SQLite and MySQL (8.0+ / MariaDB 10.5+) round-trip nested JSON transparently; older MySQL/MariaDB throw `KICK_DB_RELATIONAL_NOT_SUPPORTED`. The `db.query` namespace is read-only — use `insertInto` / `updateTable` / `deleteFrom` for writes.
:::

### Cancellation with `RequestContext.signal`

Bind the query to the request's `AbortSignal` so it is cancelled at the dialect level when the client disconnects or the request times out:

```ts
@Get('/')
list(ctx: RequestContext) {
  return this.db.query.users.findMany({
    with: { posts: true },
    signal: ctx.signal,
  })
}
```

A cancelled query rejects with `RelationalQueryCancelledError`.

## Transactions

`transaction(fn)` passes a fully-scoped child client. It auto-commits on success and rolls back on throw:

```ts
await this.db.transaction(async (tx) => {
  const user = await tx
    .insertInto('users')
    .values({ email })
    .returningAll()
    .executeTakeFirstOrThrow()

  await tx.insertInto('profiles').values({ userId: user.id }).execute()
})
```

Set an isolation level with the options form:

```ts
await this.db.transaction({ isolation: 'serializable' }, async (tx) => {
  // ...
})
```

### Savepoints

Inside a transaction, `savepoint(fn)` creates a nested rollback boundary — a throw inside rolls back only the savepoint:

```ts
await this.db.transaction(async (tx) => {
  await tx.insertInto('users').values({ email }).execute()

  await tx.savepoint(async (sp) => {
    await sp.insertInto('audit').values({ action: 'create' }).execute()
    // a throw here rolls back only the audit insert
  })
})
```

## Lifecycle events

Enable events on the client (`events: true`, or set `slowQueryThresholdMs`) and subscribe with `on()`:

```ts
const db = createDbClient({
  schema,
  dialect: pgDialect({ pool }),
  events: true,
  slowQueryThresholdMs: 100,
})

db.on('query', ({ sql, parameters, durationMs }) => {
  logger.debug({ sql, durationMs }, 'query')
})

db.on('slowQuery', ({ sql, durationMs, thresholdMs }) => {
  logger.warn({ sql, durationMs, thresholdMs }, 'slow query')
})

db.on('queryError', ({ sql, error }) => {
  Sentry.captureException(error, { extra: { sql } })
})
```

Available events: `query`, `queryError`, `slowQuery`, `transactionStart`, `transactionCommit`, `transactionRollback`, and `beforeQuery`. When a `bus` is wired (e.g. from `DEVTOOLS_BUS`), `slowQuery` and `queryError` are also republished under `db:slow-query` / `db:query-error` for the DevTools panel.

## Per-table methods with `$extends`

`db.$extends({ model })` bolts adopter-defined methods onto each table accessor. Inside a method, `this` is the extended client:

```ts
const dbX = db.$extends({
  model: {
    users: {
      findByEmail(email: string) {
        const self = this as unknown as typeof db
        return self.selectFrom('users').selectAll().where('email', '=', email).executeTakeFirst()
      },
    },
  },
})

await dbX.users.findByEmail('a@b.com')
```

The original client methods (`selectFrom`, `query`, `transaction`, `dialect`, `qb`) all flow through the extended client unchanged. See [Extensions](../db-extensions) for the full surface.

## Safe NULL comparison

By default, `eb('col', '=', null)` compiles to `= NULL` (which is silently false in SQL). Pass `safeNullComparison()` so `= null` / `!= null` compile to `IS NULL` / `IS NOT NULL`:

```ts
import { createDbClient, safeNullComparison } from '@forinda/kickjs-db'

const db = createDbClient({
  schema,
  dialect: pgDialect({ pool }),
  plugins: [safeNullComparison()],
})
```

::: warning Use the kickjs version
Import `safeNullComparison()` from `@forinda/kickjs-db`, **not** Kysely's `SafeNullComparisonPlugin` — the upstream version is broken on Postgres.
:::

## Pagination with `ctx.paginate`

KickJS's HTTP layer already parses `page` / `limit` / filters / sort off the query string. `ctx.paginate()` wraps a fetcher that returns `{ data, total }` and emits a standardized paginated response. Use `parsed.pagination.limit` / `parsed.pagination.offset` to bound the query:

```ts
import { Controller, Get, type RequestContext } from '@forinda/kickjs'

@Controller('/users')
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
