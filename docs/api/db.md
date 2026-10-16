# @forinda/kickjs-db

KickJS-native ORM — code-first schema, reversible migrations, multi-dialect SQL builder. Snapshot-diff migration engine, a single-round-trip relational query layer, lifecycle events, and a lifecycle adapter for KickJS apps.

Dialects ship as subpaths of the same package — `@forinda/kickjs-db/pg`, `@forinda/kickjs-db/sqlite`, `@forinda/kickjs-db/mysql`. Install the matching driver (`pg`, `better-sqlite3`, `mysql2`) yourself, or let `kick add` do it.

New to kick/db? Start with the [Database guide](../guide/database/index.md); this page is the reference.

## Installation

```bash
# Using the KickJS CLI — core package + the driver for your dialect
kick add pg        # or: kick add sqlite / kick add mysql / kick add db (core only)

# Manual install
pnpm add @forinda/kickjs-db pg
```

## Entry points

| Import                               | Contents                                                                                                     |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `@forinda/kickjs-db`                 | Schema DSL, `createDbClient`, `kickDbAdapter`, tokens, query helpers, migration engine + runner, errors      |
| `@forinda/kickjs-db/pg`              | `pgDialect`, `pgAdapter`, `pgEnum`, `pgSchema`, `materializedView`, `pgRole`, `policy`, PG-only column types |
| `@forinda/kickjs-db/mysql`           | `mysqlDialect`, `mysqlAdapter`, MySQL-only column types                                                      |
| `@forinda/kickjs-db/sqlite`          | `sqliteDialect`, `sqliteAdapter`, `asyncSqliteAdapter`, `libsqlDriver`, `d1Driver`                           |
| `@forinda/kickjs-db/schema`          | `insertSchema`, `selectSchema`, `updateSchema`, `InferSelect`, `InferInsert`                                 |
| `@forinda/kickjs-db/testing`         | `createTestDb`, `createPgTestDb`, `rolledBack`, `captureQueries`, `expectQueries`                            |
| `@forinda/kickjs-db/cli`             | `dbCliPlugin`, `kickDbTypegen`, `defineKickDbConfig`, `registerDbCommands`, config helpers                   |
| `@forinda/kickjs-db/devtools-events` | Side-effect import — types the `db:*` DevTools bus events                                                    |

The package also ships a `kickjs-db` binary — the `kick db` commands without `@forinda/kickjs-cli`.

## Quick Start

```ts
// src/db/schema.ts
import { table, uuid, varchar, timestamp } from '@forinda/kickjs-db'

export const users = table('users', {
  id: uuid().primaryKey().defaultRandom(),
  email: varchar(255).notNull().unique(),
  createdAt: timestamp().notNull().defaultNow(),
})
```

```ts
// src/db/client.ts
import pg from 'pg'
import { createToken } from '@forinda/kickjs'
import { createDbClient } from '@forinda/kickjs-db'
import { pgAdapter, pgDialect } from '@forinda/kickjs-db/pg'
import * as schema from './schema'

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })

export const db = createDbClient({ schema, dialect: pgDialect({ pool }) })
export const migrationAdapter = pgAdapter({ pool, endPoolOnClose: true }) // shutdown ends the shared pool
export const APP_DB = createToken<typeof db>('app/Db')
```

```ts
// src/index.ts — kickDbAdapter handles pending migrations on boot + closes on shutdown
import { kickDbAdapter } from '@forinda/kickjs-db'

export const app = await bootstrap({
  modules, // one of them registers APP_DB: container.registerFactory(APP_DB, () => db)
  adapters: [kickDbAdapter({ migrationAdapter, migrationsDir: 'db/migrations' })],
})
```

```ts
@Service()
class UsersRepository {
  @Inject(APP_DB) private db!: typeof db

  findById(id: string) {
    return this.db.selectFrom('users').selectAll().where('id', '=', id).executeTakeFirst()
  }
}
```

Full walkthrough, including registering the client in a module: [Database → Make it injectable](../guide/database/index.md#_6-make-it-injectable).

## `kickDbAdapter(config)`

A `defineAdapter()` lifecycle adapter. It does not create or register the query client — you own that (see above). It:

1. **`beforeStart`** — reads migration status and acts on `migrationsOnBoot`; registers the migration adapter under `token` when given.
2. **`shutdown`** — calls `migrationAdapter.close()` (which ends the pool only when the adapter was created with `endPoolOnClose: true`).

### `KickDbAdapterConfig`

| Option             | Type                                       | Default             | Description                                                                                 |
| ------------------ | ------------------------------------------ | ------------------- | ------------------------------------------------------------------------------------------- |
| `migrationAdapter` | `MigrationAdapter`                         | required            | `pgAdapter()`, `mysqlAdapter()`, `sqliteAdapter()`, `asyncSqliteAdapter()`                  |
| `migrationsDir`    | `MigrationsLocation`                       | required            | A folder, several folders run as one history, or `migrationFiles(...)` for a bundled deploy |
| `migrationsOnBoot` | `'fail-if-pending' \| 'apply' \| 'ignore'` | `'fail-if-pending'` | Throw on pending migrations, apply them (`migrateLatest`), or boot regardless               |
| `driftCheck`       | `'error' \| 'warn' \| 'ignore'`            | runner default      | Drift detection when `apply` runs migrations                                                |
| `requireReviewed`  | `boolean`                                  | `true` outside dev  | Refuse unreviewed migrations when `apply` runs them                                         |
| `token`            | `InjectionToken<MigrationAdapter>`         | —                   | Register the migration adapter in DI for ad-hoc tooling                                     |
| `bus`              | `KickEventBus`                             | —                   | DevTools bus; `db:migration-applied` fires after a boot-time apply                          |

See [Migrations → Boot-time policy](../guide/database/migrations.md#boot-time-policy).

### DI tokens

`DB_PRIMARY`, `DB_REPLICA` (`InjectionToken<KickDbClient>`, keys `kick/db/primary` / `kick/db/replica`) and `DB_CLIENT` (alias of `DB_PRIMARY`) are pre-made tokens. **Nothing registers them for you** — bind a client to one yourself if the shape fits, or define your own token typed with `typeof db` (recommended; it carries your exact schema).

## `createDbClient(options)`

```ts
const db = createDbClient({
  schema,
  dialect: pgDialect({ pool }),
  replica: pgDialect({ pool: replicaPool }),
  slowQueryThresholdMs: 100,
})
```

### `CreateDbClientOptions`

| Option                 | Type                                | Default | Description                                                                                                                         |
| ---------------------- | ----------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `schema`               | `TSchema`                           | —       | Schema record — the client's types are inferred from it                                                                             |
| `dialect`              | `Dialect` (Kysely)                  | —       | `pgDialect` / `mysqlDialect` / `sqliteDialect`, or any Kysely dialect (Neon, D1, libsql, `bun:sqlite`…)                             |
| `dialectTag`           | `'postgres' \| 'mysql' \| 'sqlite'` | —       | Which SQL `dialect` speaks, for a dialect kick/db can't place ([Drivers](../guide/database/drivers.md#serverless-and-edge-drivers)) |
| `replica`              | `Dialect \| Dialect[]`              | —       | Read replicas — reads outside a transaction go to them, in turn                                                                     |
| `route`                | `ReadRouter`                        | —       | Per-read choice: return `'primary'`, a replica index, or `undefined` for the default                                                |
| `tenancy`              | `Tenancy`                           | —       | From `defineTenancy()` — see [Tenancy](#tenancy)                                                                                    |
| `casing`               | `'snake_case'`                      | —       | camelCase keys in TS, snake_case names in the database (set the same in `kick.config.ts`)                                           |
| `events`               | `boolean`                           | `false` | Enable lifecycle events. Zero overhead when off                                                                                     |
| `slowQueryThresholdMs` | `number \| null`                    | `null`  | Fire `slowQuery` above this duration; implies `events: true`                                                                        |
| `asyncStackTraces`     | `boolean`                           | `false` | Append where each query was built to its error's stack (records a stack per query — for development)                                |
| `bus`                  | `KickEventBus`                      | —       | Republish `db:slow-query` / `db:query-error` to DevTools; implies `events: true`                                                    |
| `plugins`              | `KyselyPlugin[]`                    | —       | Extra query-builder plugins, run after the built-ins (see [`safeNullComparison()`](#safenullcomparison))                            |

Every query the client runs reports driver failures as [typed errors](#errors) with the driver's error as `cause`. Replicas and `route`: [Pooling → Read replicas](../guide/database/pooling.md#read-replicas).

## `KickDbClient`

```ts
interface KickDbClient<DB = RegisteredDB> {
  readonly qb: Kysely<DB> // full query builder — escape hatch
  readonly dialect: 'postgres' | 'sqlite' | 'mysql'

  selectFrom, insertInto, updateTable, deleteFrom, with, withRecursive // Kysely builders
  cte(name, query): readonly [name, query]

  readonly query: QueryNamespace<DB> // relational layer

  upsert(table, { values, target, update? /* or false */, where?, maxParams?, atomic? }): Promise<Row | Row[]>
  insertMany(table, rows, { returning?, readBack?, maxParams?, atomic? }?): Promise<number | Row[]>
  findOrCreate(table, { where, create? }): Promise<{ row: Row; created: boolean }>
  refreshMaterializedView(name, { concurrently? }?): Promise<void>
  timeout(ms, { signal? }?): { signal; inflightQueryAbortStrategy } // .execute(db.timeout(5_000)) — cancels on the server
  startTransaction(opts?): Promise<KickDbClient & { commit(); rollback() }> // a transaction you finish yourself

  transaction<T>(fn): Promise<T>
  transaction<T>(opts: TransactionOptions, fn): Promise<T>
  savepoint<T>(fn): Promise<T>
  afterCommit(fn: () => unknown): Promise<void>
  readonly inTransaction: boolean
  readonly primary: KickDbClient<DB> // every read on the primary (read-your-writes)

  on(event, listener): this
  off(event, listener): this
  $extends(ext): ExtendedClient // { model?, result? }
  destroy(): Promise<void>
}
```

### `insertMany` / `upsert` / `findOrCreate`

```ts
// Split into as many statements as the dialect's bind-parameter cap needs, in one transaction
const count = await db.insertMany('events', rows)
const inserted = await db.insertMany('events', rows, { returning: true })

// Insert, or update the rows whose `target` key already exists — returns the stored row(s)
await db.upsert('pageViews', {
  values: { path, views: 1 },
  target: ['path'],
  update: { views: sql`page_views.views + 1` },
})

const { row, created } = await db.findOrCreate('tags', { where: { slug }, create: { label } })
```

| Option      | Applies to             | Default              | Description                                                                                                                                     |
| ----------- | ---------------------- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `maxParams` | `insertMany`, `upsert` | dialect limit        | Bind parameters per statement (65,535 Postgres/MySQL, 32,766 SQLite); `100` for Cloudflare D1                                                   |
| `atomic`    | `insertMany`, `upsert` | `true`               | All statements in one transaction (joining an open one); `false` for drivers without transactions                                               |
| `returning` | `insertMany`           | `false`              | `true` returns the inserted rows instead of the count                                                                                           |
| `readBack`  | `insertMany`           | —                    | MySQL, with `returning`: a unique key every row gives, to read the rows back by (it has no RETURNING)                                           |
| `target`    | `upsert`               | required             | Unique / primary key columns whose conflict turns the insert into an update                                                                     |
| `update`    | `upsert`               | every non-key column | Column names to take from the incoming row, or an object of values / expressions; `false` skips a row whose key exists and returns it as stored |
| `where`     | `upsert`               | —                    | Predicate of a partial unique index `target` refers to (Postgres, SQLite)                                                                       |

Guide: [Queries → Upsert and find-or-create](../guide/database/queries.md#upsert-and-find-or-create), [Performance → Insert many rows](../guide/database/performance.md#insert-many-rows-in-one-statement).

### Lifecycle events

Subscribe via `db.on(event, listener)`. Events fire when `events: true` (or `slowQueryThresholdMs` / `bus` is set).

| Event                 | Payload                                        | When                                                                      |
| --------------------- | ---------------------------------------------- | ------------------------------------------------------------------------- |
| `beforeQuery`         | `{ sql, parameters }` (mutable)                | Before query executes — mutate `sql`/`parameters` for RLS-style rewriting |
| `query`               | `{ sql, parameters, durationMs }`              | After successful query                                                    |
| `queryError`          | `{ sql, parameters, error }`                   | On query failure                                                          |
| `slowQuery`           | `{ sql, parameters, durationMs, thresholdMs }` | When duration exceeds `slowQueryThresholdMs`                              |
| `transactionStart`    | `{ isolation? }`                               | Transaction opens                                                         |
| `transactionCommit`   | `{ isolation? }`                               | Transaction commits                                                       |
| `transactionRollback` | `{ isolation?, error }`                        | Transaction rolls back                                                    |
| `transactionRetry`    | `{ isolation?, attempt, error, delayMs }`      | A `retry` transaction is about to run again                               |

`beforeQuery`, `query`, `slowQuery` and `queryError` also carry `queryId`, and `txId` inside a `transaction()`.

```ts
db.on('slowQuery', ({ sql, durationMs }) => logger.warn({ sql, durationMs }, 'slow query'))
```

Guide: [Events & Plugins](../guide/database/events-plugins.md).

### Transactions + savepoints

Inside `transaction(fn)` the plain client joins the transaction too — code holding the injected `db` takes part without being handed `tx`. Full guide: [Transactions](../guide/database/transactions.md).

```ts
await db.transaction(async () => {
  await usersRepo.create({ email }) // uses db internally — same transaction
  await db.afterCommit(() => mailer.sendWelcome(email)) // after COMMIT; dropped on rollback
})

await db.transaction({ isolation: 'serializable', retry: true }, async () => { ... })

await db.savepoint(async () => {
  await db.insertInto('audit_log').values({ ... }).execute()
  throw new Error('rolls back the savepoint, keeps the outer transaction')
})
```

`TransactionOptions`:

| Option      | Type                                                                            | Description                                                                                                          |
| ----------- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `isolation` | `'serializable' \| 'repeatable read' \| 'read committed' \| 'read uncommitted'` | `SET TRANSACTION ISOLATION LEVEL` — when a transaction starts                                                        |
| `nested`    | `'reuse' \| 'savepoint' \| 'separate'`                                          | When one is already open: join it (default), run behind a savepoint, or open an independent one (not on SQLite)      |
| `durable`   | `boolean`                                                                       | Must be the outermost transaction, so returning means committed; throws if one is already open                       |
| `readOnly`  | `boolean`                                                                       | Start read-only (Postgres, MySQL); refused on SQLite                                                                 |
| `role`      | `string`                                                                        | `SET LOCAL ROLE` for the transaction (Postgres) — see [Row-Level Security](../guide/database/row-level-security.md)  |
| `settings`  | `Record<string, string \| number \| boolean>`                                   | Per-transaction settings (Postgres) — e.g. the identity RLS policies read                                            |
| `retry`     | `boolean \| number \| { attempts, baseDelayMs?, maxDelayMs? }`                  | Run again on `retryable` errors (serialization failure, deadlock); `true` = 3 attempts, jittered exponential backoff |

`afterCommit(fn)` runs `fn` after the commit, drops it on rollback (including a rolled-back savepoint), and runs it at once outside a transaction; a failing hook is reported, not thrown. `inTransaction` says whether the current call chain is inside one.

## Schema DSL

### `table(name, columns, options?)`

```ts
const posts = table(
  'posts',
  {
    id: serial().primaryKey(),
    authorId: integer()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    title: varchar(200).notNull(),
    meta: json<{ tags: string[] }>(),
    publishedAt: timestamp(),
  },
  (t) => ({
    authorIdx: index('posts_author_idx').on(t.authorId),
    uniqueSlug: unique('posts_slug_unique').on(t.title, t.authorId),
    titleLength: check('posts_title_length', 'length(title) > 0'),
  }),
)
```

`options` is either the constraints builder or `{ constraints?, comment?, rls? }`. The builder returns a record of `index()` / `unique()` (chain `.where()`, `.using()`, `.include()`, `.op()`), `check(name, expression)`, `policy()` (Postgres) and at most one `primaryKey(name?).on(...)` for a composite or named key. See [Constraints](../guide/database/constraints.md) and [Schema](../guide/database/schema.md).

The same table can be declared as a class or with a fluent builder — `tableFromClass`, `TableBase`, `defineTable`, `fk`, `link`, `Rule` ([Table Forms](../guide/db-table-forms.md)) — and validated with `insertSchema` / `selectSchema` / `updateSchema` from `@forinda/kickjs-db/schema` ([Validation from Tables](../guide/db-table-schemas.md)). `selfRef('id')` references a column of the table being declared; `alias(table, name)` joins a table to itself ([Queries → `alias()`](../guide/database/queries.md#a-table-twice-alias)).

### Column constructors

Cross-dialect (package root): `serial`, `bigSerial`, `smallSerial`, `integer`, `bigint({ mode? })`, `smallint`, `version` (optimistic-locking counter), `decimal(p?, s?, { mode? })`, `numeric(p?, s?, { mode? })`, `real`, `doublePrecision`, `varchar(n = 255)`, `char(n = 1)`, `text`, `boolean`, `timestamp({ precision? })`, `timestamptz({ precision? })`, `date`, `time({ precision? })`, `interval`, `uuid`, `json<T>()`, `jsonb<T>()`, `bytea`.

Modifiers: `.notNull()`, `.primaryKey()`, `.unique()`, `.array()`, `.default(value)` (a value), `.defaultSql(expression)` (SQL the database evaluates), `.defaultNow()` (timestamps), `.defaultRandom()` (uuid), `.$defaultFn(fn)`, `.$onUpdate(fn)`, `.onUpdateNow()`, `.softDelete()`, `.generatedAlwaysAs(sql, { stored? })`, `.generatedAlwaysAsIdentity()`, `.generatedByDefaultAsIdentity()`, `.references(() => col, { onDelete?, onUpdate?, name? })`, `.comment(text)`, `.colName(name)`. Details: [Schema → Column builders](../guide/database/schema.md#column-builders).

PG-only (`@forinda/kickjs-db/pg`): `pgEnum(name, ...values)`, `tsvector`, `vector(dim?)`, `halfvec(dim?)`, `point`, `geometry(type?, srid?)`, `macaddr`, `macaddr8`, `citext`, `money`, `inet`, `cidr`, `xml`. MySQL-only (`@forinda/kickjs-db/mysql`): `mysqlEnum(...values)`, `unsigned(col)`, `tinyint`, `mediumint`, `datetime(fsp?)`. See [Postgres enums](../guide/database/schema.md#postgres-enums) and [MySQL-only types](../guide/database/schema.md#mysql-only-types).

Row-level security (Postgres): `policy(name)` in a table's constraints and `table(name, columns, { rls: { force } })`; roles with `pgRole(name, options)`; per-transaction identity with `db.transaction({ role, settings }, fn)` ([Row-Level Security](../guide/database/row-level-security.md)).

Views: `view(name, columns, { as })` (root) and `materializedView(name, columns, { as, constraints? })` (`/pg`), refreshed with `db.refreshMaterializedView(name, { concurrently })` ([Views](../guide/database/schema.md#views)).

### `relations()`

```ts
import { relations } from '@forinda/kickjs-db'

export const usersRelations = relations(users, ({ many }) => ({
  posts: many(posts),
}))

export const postsRelations = relations(posts, ({ one, many }) => ({
  author: one(users, { fields: [posts.authorId], references: [users.id] }),
  tags: many(tags, { through: postTags }), // many-to-many via a junction table
}))
```

`morphMany(target, { type, id, as, references? })` is a polymorphic `many`: the target rows whose `type` column holds `as` and whose `id` column holds the source's key (`references`, default the source's single-column primary key). No foreign key is involved; it's typed and queried like `many`. `morphOne` takes the same options and reads one such row, typed and queried like `one`. `morphTo({ type, id, targets })`, declared on the child, reads the row its pair points at: `targets` maps each type value to a table, whose primary key is matched against `id`. The subject carries `__type`, its type value, and is typed as a union narrowed by it. `with` takes `true` or `{ withDeleted?, targets?: { <type>: true | { columns, extras, where, with, withDeleted } } }`.

```ts
export const postsRelations = relations(posts, ({ morphMany }) => ({
  comments: morphMany(comments, { type: comments.subjectType, id: comments.subjectId, as: 'post' }),
}))
```

See [Relational Queries → Polymorphic associations](../guide/db-relational-query.md#polymorphic-associations).

For multi-FK schemas, tag with `relationName: 'foo'` on both sides to disambiguate. See [Schema → Relations](../guide/database/schema.md#relations-for-db-query).

### `customType<T>()`

```ts
import { customType } from '@forinda/kickjs-db'

const encrypted = customType<string>({
  dataType: () => 'text',
  toDriver: (v) => encrypt(v),
  fromDriver: (v) => decrypt(v as string),
})
```

See [DB Extensions](../guide/db-extensions.md) for the full mapper signature.

### `pgSchema(name)`

Declare a PostgreSQL named schema and hang tables off it (`@forinda/kickjs-db/pg`).

```ts
import { serial } from '@forinda/kickjs-db'
import { pgSchema } from '@forinda/kickjs-db/pg'

const billing = pgSchema('billing')
const invoices = billing.table('invoices', { id: serial().primaryKey() })

await db.selectFrom('billing.invoices').selectAll().execute()
```

Migrations emit `CREATE SCHEMA IF NOT EXISTS` and qualify every statement for the table. Snapshot keys are the qualified name, so two schemas may hold same-named tables. `pgSchema('public')` collapses to no schema. Schemas are never dropped by a migration. Declaring a schema and diffing against MySQL or SQLite throws at snapshot time.

::: tip Introspection scope
`kick db introspect` and drift detection read a single schema — the one set via `pgAdapter({ schema })`, default `public`. Tables in other schemas are created and migrated, but not compared against the live database.
:::

## Query API

### Typed query builder

```ts
await db.selectFrom('users').where('email', '=', 'x@y.z').selectAll().executeTakeFirst()
await db.insertInto('posts').values({ authorId: 1, title: 't' }).returningAll().execute()
await db.updateTable('users').set({ name: 'X' }).where('id', '=', 1).executeTakeFirst()
await db.deleteFrom('posts').where('id', '=', 5).execute()
```

`Kysely`, `sql` and the types `Expression`, `ExpressionBuilder`, `KyselyPlugin`, `RawBuilder`, `Sql`, `SqlBool` are re-exported from the root. Guide: [Queries](../guide/database/queries.md), [Raw SQL](../guide/database/raw-sql.md).

### Condition helpers and safe `LIKE`

Root exports for `where` / `orderBy` callbacks: `eq`, `ne`, `gt`, `gte`, `lt`, `lte`, `like`, `notLike`, `ilike`, `isNull`, `isNotNull`, `inArray`, `notInArray`, `between`, `and`, `or`, `not`, `exists`, `notExists`, `asc`, `desc` ([Condition helpers](../guide/database/queries.md#condition-helpers)).

User input in a `LIKE` pattern goes through `likePattern(input, mode)` (or `escapeLike(input)`), which escapes `%`, `_` and `\`. `mode` is `'contains'` (default), `'startsWith'`, `'endsWith'` or `'exact'`. SQLite has no default escape character — add `escape '\'` ([Raw SQL → LIKE](../guide/database/raw-sql.md#searching-with-like)).

```ts
await db.selectFrom('users').where('email', 'like', likePattern(search)).selectAll().execute()
```

### Relational queries — `db.query.<table>`

`findMany(opts?)`, `findFirst(opts?)`, `findUnique(opts)`, and `findManyAndCount(opts?)` → `{ data, total }` (two queries; the shape `ctx.paginate` takes).

```ts
await db.query.users.findMany({
  where: (u, { eq }) => eq(u.isActive, true),
  columns: { passwordHash: false },
  with: { posts: { where: (p, { isNotNull }) => isNotNull(p.publishedAt), limit: 5 } },
  orderBy: (u, { desc }) => desc(u.createdAt),
  limit: 20,
  signal: ctx.signal,
})
```

| Option        | Type                                     | Description                                                                  |
| ------------- | ---------------------------------------- | ---------------------------------------------------------------------------- |
| `where`       | `(t, ops) => Expression`                 | Filter callback — receives the row refs + operator helpers                   |
| `orderBy`     | `(t, ops) => Expression \| Expression[]` | Sort callback                                                                |
| `limit`       | `number`                                 | Row cap                                                                      |
| `offset`      | `number`                                 | Rows to skip                                                                 |
| `columns`     | `{ [col]?: boolean }`                    | Include (`true`) or exclude (`false`) columns — not both kinds               |
| `extras`      | `{ [name]: (t, ops) => Expression }`     | Computed fields                                                              |
| `with`        | `{ [relation]: true \| NestedOptions }`  | Eager-load relations declared via `relations()`                              |
| `withDeleted` | `boolean`                                | Include rows a `softDelete()` column marks deleted (this level only)         |
| `maxDepth`    | `number`                                 | Max relational-nesting depth (default 5); `RelationalQueryDepthError` beyond |
| `signal`      | `AbortSignal`                            | Request-scoped cancellation                                                  |
| `timeoutMs`   | `number`                                 | Cancel once the read has run this long; with `signal`, whichever fires first |

Single round trip, JSON aggregation per dialect. See [Relational Queries](../guide/db-relational-query.md).

When `signal` fires or `timeoutMs` passes, the promise rejects with `RelationalQueryCancelledError` (its `cause` is the abort reason); an already-aborted signal rejects before any round trip. The query is cancelled on the server (Postgres `pg_cancel_backend`, MySQL `KILL QUERY`), except inside a transaction, where cancelling would abort the transaction, so it's abandoned and finishes there. `signal` and `timeoutMs` belong to the top level only. For the query builders, `db.timeout(ms, { signal? })` gives the same — see [Queries → Timeouts and cancellation](../guide/database/queries.md#timeouts-and-cancellation).

## Plugins

### `safeNullComparison()`

`eb('col', '=', null)` compiles to `IS NULL` instead of the silently-false `= NULL`. Opt-in via `createDbClient({ plugins: [safeNullComparison()] })`. Use this one, not Kysely's `SafeNullComparisonPlugin`.

```ts
await db.selectFrom('users').where('deletedAt', '=', null).selectAll().execute()
// → select * from "users" where "deletedAt" is null
```

## Tenancy

`defineTenancy({ strategy, ... })` — `strategy` is `'column' | 'rls' | 'schema' | 'database'` — returns a `Tenancy` with `run(tenantId, fn)`, `bypass(fn, { reason })` and `current()`. Pass it to `createDbClient({ tenancy })`; mark the tenant column with `tenantKey(tenancy, column?)`. A query with no current tenant throws `TenantRequiredError`. `migrateTenants({ tenants, adapterFor, migrationsDir, concurrency?, stopOnError? })` migrates each tenant. Guide: [Tenancy](../guide/database/tenancy.md).

## Dialects and migration adapters

Each dialect subpath exports a query `*Dialect` (for `createDbClient`) and a `*Adapter` (`MigrationAdapter`, for the runner, `kickDbAdapter` and `kick db`).

| Function                                                                               | Notes                                                                                                      |
| -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `pgDialect({ pool, cursor? })`                                                         | `pool`: `pg.Pool` or any pg-compatible pool; `cursor`: `pg-cursor`'s class, for `.stream()`                |
| `pgAdapter({ pool, schema?, migrationsTable?, endPoolOnClose? })`                      | `schema` default `'public'`; `migrationsTable` default `kick_migrations`; `endPoolOnClose` default `false` |
| `mysqlDialect({ pool })` / `mysqlAdapter({ pool, migrationsTable?, endPoolOnClose? })` | `mysql2` pool                                                                                              |
| `sqliteDialect({ database })` / `sqliteAdapter({ database, migrationsTable? })`        | `better-sqlite3` (or compatible) handle                                                                    |
| `asyncSqliteAdapter({ driver, kysely?, migrationsTable?, close? })`                    | Async SQLite drivers — `libsqlDriver(client)` (libsql / Turso), `d1Driver(db)` (Cloudflare D1)             |

Guides: [Drivers](../guide/database/drivers.md), [Pooling](../guide/database/pooling.md).

## Migration API

Guide: [Migrations](../guide/database/migrations.md#running-migrations-from-code), [CI & Deploy](../guide/database/ci-deploy.md).

### Runner

| Function                                    | Behaviour                                                                    |
| ------------------------------------------- | ---------------------------------------------------------------------------- |
| `migrateLatest(opts)`                       | Apply all pending in a new batch → `AppliedSummary`                          |
| `migrateUp({ ...opts, to? })`               | Apply the next pending, or every pending up to `to` → `AppliedSummary`       |
| `migrateDown({ ...opts, to? })`             | Reverse the most recent, or every one applied after `to` → `ReversedSummary` |
| `migrateRollback({ ...opts, all? })`        | Reverse the last batch as one unit, or every migration → `RollbackSummary`   |
| `migrateStatus({ adapter, migrationsDir })` | Applied + pending entries → `StatusEntry[]`                                  |

`RunnerOptions`: `adapter`, `migrationsDir`, `requireReviewed?` (default `true` outside dev), `driftCheck?` (default `'error'`), `confirmEnumDrop?` (default `false`), `owner?`, `log?`.

`migrationsDir` is a folder, several folders run as one history, or `migrationFiles(files, modules?)` — the migration files bundled into the app ([No migrations folder at run time](../guide/database/ci-deploy.md#bundled-migrations)). For tests, `MemoryMigrationAdapter` implements `MigrationAdapter` in memory.

### Programmatic CLI equivalents

| Function                                                                    | Equivalent                                                          |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `generate({ name, config, cwd, empty?, typescript?, renames?, ... })`       | `kick db generate` — returns `GenerateResult`                       |
| `checkMigrations({ config, cwd })`                                          | `kick db check` — `{ unmigratedChanges, unreviewed, modified, ok }` |
| `pushSchema({ adapter, schema, casing?, renames?, confirmDataLoss?, ... })` | `kick db push` — `{ status, changeCount }`                          |
| `reviewMigration(migrationsDir, id)`                                        | `kick db migrate review <id>`                                       |
| `runSeeds({ dir, names? })` / `listSeeds(dir)`                              | `kick db seed`                                                      |
| `seedFake(db, schema, opts)` / `fakeRows(table, opts)`                      | Generate fake rows from the schema                                  |
| `resolveDbConfig(...)`                                                      | Resolve the `db` config block to a `DbConfig`                       |

### Diff, emit, introspect

```ts
import { diff, invertChanges, emitPg, emitSqlite, extractSnapshot } from '@forinda/kickjs-db'

const next = extractSnapshot(schema, 'postgres')
const forward = diff(prevSnapshot, next) // ChangeSet; options: { renames? }
const reverse = invertChanges(forward) // see hasAmbiguousReverse(forward)
const upSql = emitPg(forward)
emitSqlite(forward, { from: prevSnapshot, to: next }) // table rebuilds need both snapshots
```

- `emitPg` / `emitMysql` / `emitSqlite` — `ChangeSet` → SQL text.
- `findRenameCandidates` — drops that may be renames, for `RenameHints`.
- `introspectPg(runner, { schema? })`, `await introspectMysql(connection, opts?)`, `introspectSqlite(database, opts?)` (sync), `await introspectSqliteAsync(query, opts?)` — live database → `SchemaSnapshot`. `renderSchemaSource(snapshot)` turns one into TS schema source.
- `checkDrift(live, expected, behavior, log?)` — `'error'` throws `MigrationDriftError`, `'warn'` logs, `'ignore'` skips.
- `detectCompositeReferences(runner, enumName)` — PG composite types using an enum (the enum-drop gate).
- Lower level: `readJournal`, `appendJournalEntry`, `computeMigrationHash`, `verifyMigrationHash`, `parseEnumDropHeader`, `enforceEnumDropGate`, `migrationsTableDdl`, `lockTableDdl`, `lockTableName`, `pushTableName`, `quoteTable`, `KICK_MIGRATIONS_TABLE` (`'kick_migrations'`), `KICK_LOCK_TABLE` (`'kick_migrations_lock'`), `fitIdentifier`, `toDbName`, `toKeyName`.

### Snapshot types

`Dialect`, `FkAction`, `ColumnSnapshot`, `IndexSnapshot`, `ForeignKeySnapshot`, `CheckSnapshot`, `TableSnapshot`, `EnumSnapshot`, `RelationSnapshot`, `SchemaSnapshot`. `SchemaSnapshot` is `{ version: 1, dialect, tables, schemas?, enums?, views?, roles?, relations? }` — JSON-serializable.

## Errors

Rooted at `KickDbError` (`.code`). Guide: [Errors](../guide/database/errors.md).

```text
KickDbError
├── DatabaseError                   a failure the database reported — .dialect, .driverCode,
│   │                               .constraint, .table, .columns, .detail, .retryable, .cause
│   ├── UniqueViolationError        duplicate unique / primary key — .status = 409
│   ├── ForeignKeyViolationError
│   ├── CheckViolationError
│   ├── NotNullViolationError
│   ├── SerializationFailureError   .retryable = true
│   ├── DeadlockError               .retryable = true
│   └── ConnectionError
├── TransactionFinishedError        a query ran after its transaction finished (un-awaited work)
├── RemovedValueAsDefaultError      pgEnum value being removed is still a column DEFAULT
├── CompositeEnumReferenceError     pgEnum value removal blocked by a composite type
├── RelationalQueryCancelledError   AbortSignal fired during db.query.*
├── RelationalQueryUnknownRelationError
├── RelationalQueryAmbiguousRelationNameError
├── RelationalQueryMissingInverseError
├── RelationalQueryThroughError     a `through` junction can't be resolved
├── RelationalQueryDepthError
├── RelationalQueryAliasCollisionError
├── RelationalQueryNotSupportedError
└── MigrationError
    ├── MigrationFailedError        a migration's SQL failed — .id, driver error as .cause
    ├── MigrationDriftError         introspected DB ≠ last applied snapshot
    ├── MigrationLockError          another migration in progress
    ├── MigrationHashError          journal hash mismatch — tampered or corrupt
    ├── UnreviewedMigrationError    reviewed: false where review is required
    └── MigrationEnumDropError      missing --confirm-enum-drop on a KICK ENUM REMOVE migration
```

Not `KickDbError`s: `TenantRequiredError` (no current tenant) and `SqliteRebuildRequiredError` (`emitSqlite` needs a table rebuild without the snapshots). `translateDbError(err, dialect)` turns a raw driver error into a `DatabaseError` class — for drivers you call directly; the client already does it.

## Testing — `@forinda/kickjs-db/testing`

| Function                                            | Description                                                                                   |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `createTestDb({ schema, migrationsDir?, casing? })` | In-memory SQLite client (`better-sqlite3`) — tables from the schema, or the given migrations  |
| `createPgTestDb({ schema, connectionString, ... })` | Throwaway Postgres database → `{ db, connectionString, drop() }`; call `drop()` in `afterAll` |
| `rolledBack(db, fn)`                                | Run `fn` in a transaction that always rolls back                                              |
| `captureQueries(db, fn)`                            | `{ result, queries: QueryEvent[] }`                                                           |
| `expectQueries(db, count, fn)`                      | Assert `fn` runs exactly `count` queries                                                      |

Guide: [Testing](../guide/database/testing.md).

## Types

| Export                                                                            | Use                                                                                                                        |
| --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `SchemaToTypes<S>`                                                                | Database type shape from a schema record — `type DB = SchemaToTypes<typeof schema>`                                        |
| `KickDbRegister` / `RegisteredDB`                                                 | Augmentable registry the typegen writes, so the bare `KickDbClient` is typed ([Schema Types](../guide/db-schema-types.md)) |
| `KickDbRelationsRegister`                                                         | Augmentable — keys for `with: { ... }` autocomplete                                                                        |
| `ReadonlyKysely<DB>`                                                              | Read-only handle — see [narrowing the client](../guide/db-relational-query.md#narrowing-the-client)                        |
| `ReadRoute` / `ReadRouter`                                                        | The `route` option's argument and function type                                                                            |
| `InsertManyOptions`, `UpsertOptions`, `FindOrCreateOptions`                       | Options of the client helpers above                                                                                        |
| `ExtensionDefinition`, `ExtendedClient`, `ModelExtensions`                        | `$extends()` shapes ([DB Extensions](../guide/db-extensions.md))                                                           |
| `markDialect(dialect, tag)` / `readDialectMark` / `isDialectTag` / `KICK_DIALECT` | Tag a wrapped Kysely dialect so kick/db detects it                                                                         |

## CLI — `kick db`

`dbCliPlugin` from `@forinda/kickjs-db/cli` mounts the commands on `kick` (`plugins: [dbCliPlugin]` in `kick.config.ts`, config under `db`); the standalone `kickjs-db` binary reads `kickjs-db.config.ts` (`defineKickDbConfig`). `kickDbTypegen` keeps `KickDbRegister` in sync with your schema.

| Command                                                                                           | Purpose                                                                                    |
| ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `generate <name>` (`-e/--empty`, `--ts`, `--rename-table`, `--rename-column`, `--no-interactive`) | Migration from the schema diff vs the last snapshot                                        |
| `check`                                                                                           | Fail on unmigrated schema changes, unreviewed or edited migrations — for CI (no DB needed) |
| `push` (`--accept-data-loss`, rename flags)                                                       | Make the database match the schema with no migration file — prototyping only               |
| `seed [names...]`                                                                                 | Run seed files in `db/seeds`                                                               |
| `migrate latest` (`--confirm-enum-drop`, `--tenants`)                                             | Apply every pending migration in a new batch                                               |
| `migrate up` (`--to`, `--confirm-enum-drop`)                                                      | Apply the next pending, or up to `--to`                                                    |
| `migrate down` (`--to`)                                                                           | Reverse the most recent, or everything after `--to`                                        |
| `migrate rollback` (`--all`)                                                                      | Reverse the last batch, or every migration                                                 |
| `migrate status` / `migrate review <id>` / `migrate unlock`                                       | Status table / mark reviewed / release a stale lock                                        |
| `introspect` (`--out <path>`, `--json`)                                                           | Write a TS schema (or raw snapshot JSON) from a live database                              |

Flags, output and exit codes: [CLI](../guide/database/cli.md).

## DevTools events

```ts
import '@forinda/kickjs-db/devtools-events' // side-effect: types the bus payloads
```

Adds `db:query`, `db:slow-query`, `db:query-error` and `db:migration-applied` to `KickDevtoolsEventRegistry`. The client publishes `db:slow-query` / `db:query-error` when given `bus`; `kickDbAdapter` publishes `db:migration-applied`.
