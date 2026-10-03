# @forinda/kickjs-db

KickJS-native ORM — code-first schema, reversible migrations, multi-dialect SQL builder. Snapshot-diff migration engine, a single-round-trip relational query layer, lifecycle hooks, and DI integration.

Dialect adapters ship as subpaths of the same package — `@forinda/kickjs-db/pg`, `@forinda/kickjs-db/sqlite`, `@forinda/kickjs-db/mysql`. Install the matching driver (`pg`, `better-sqlite3`, `mysql2`) yourself.

## Installation

```bash
# Using the KickJS CLI (recommended)
kick add db

# Manual install — one package plus your dialect's driver
pnpm add @forinda/kickjs-db pg
```

## Quick Start

```ts
import { bootstrap } from '@forinda/kickjs'
import {
  table,
  uuid,
  varchar,
  timestamp,
  createDbClient,
  kickDbAdapter,
  DB_PRIMARY,
} from '@forinda/kickjs-db'
import { pgAdapter, pgDialect } from '@forinda/kickjs-db/pg'

// 1. Schema — code-first, type-inferred end-to-end.
const users = table('users', {
  id: uuid().primaryKey().defaultRandom(),
  email: varchar(255).notNull().unique(),
  createdAt: timestamp().notNull().defaultNow(),
})
export const schema = { users }

// 2. App bootstrap — kickDbAdapter registers the client on DI tokens
// and runs migration check at startup.
export const app = await bootstrap({
  modules,
  adapters: [
    kickDbAdapter({
      schema,
      adapter: pgAdapter({ connectionString: process.env.DATABASE_URL }),
      migrationsOnBoot: 'fail-if-pending',
      events: true,
    }),
  ],
})

// 3. Inject in a repository.
@Service()
class UsersRepository {
  @Inject(DB_PRIMARY) private db!: KickDbClient

  findById(id: string) {
    return this.db.selectFrom('users').selectAll().where('id', '=', id).executeTakeFirst()
  }
}
```

## DI integration — `kickDbAdapter()` + DI tokens

```ts
import { kickDbAdapter, DB_PRIMARY, DB_REPLICA, DB_CLIENT } from '@forinda/kickjs-db'
```

`kickDbAdapter(config)` is a `defineAdapter()` factory that:

1. **`beforeStart`** — instantiates `KickDbClient`, registers it on a DI token, and runs migration check.
2. **`shutdown`** — calls `db.destroy()` cooperatively (group `Promise.allSettled`).
3. **`introspect()`** — emits `{ pool, dialect, lastMigration, eventCounts }` to DevTools.
4. **`contributors()`** — exposes a default contributor registering `db` on `RequestContext`.

### `KickDbAdapterConfig` — options

| Option                 | Type                                       | Default             | Description                                                               |
| ---------------------- | ------------------------------------------ | ------------------- | ------------------------------------------------------------------------- |
| `schema`               | `TSchema`                                  | required            | Schema record (`{ users, posts, ... }`)                                   |
| `adapter`              | `Adapter`                                  | required            | Dialect adapter — `pgAdapter()`, `sqliteAdapter()`, `mysqlAdapter()`      |
| `token`                | `Token<KickDbClient>`                      | `DB_PRIMARY`        | DI token to register against (use a custom one for multi-DB)              |
| `migrationsOnBoot`     | `'fail-if-pending' \| 'apply' \| 'ignore'` | `'fail-if-pending'` | Behaviour when pending migrations exist on boot                           |
| `migrationsDir`        | `string`                                   | `'db/migrations'`   | Where the migration runner reads from                                     |
| `events`               | `boolean`                                  | `false`             | Enable lifecycle event emission                                           |
| `slowQueryThresholdMs` | `number \| null`                           | `null`              | Emit `slowQuery` event above this threshold (implies `events: true`)      |
| `bus`                  | `KickEventBus`                             | —                   | Optional DevTools bus to republish events to                              |
| `plugins`              | `KyselyPlugin[]`                           | —                   | Query-builder plugins (see [`safeNullComparison()`](#safenullcomparison)) |

### Built-in DI tokens

| Token        | Resolves to           | Purpose                                                           |
| ------------ | --------------------- | ----------------------------------------------------------------- |
| `DB_PRIMARY` | `KickDbClient`        | Default — single-DB apps inject this                              |
| `DB_REPLICA` | `KickDbClient`        | Read replica — register a second adapter with `token: DB_REPLICA` |
| `DB_CLIENT`  | alias of `DB_PRIMARY` | Back-compat alias                                                 |

For sharded / multi-tenant setups, define your own tokens via `createToken<KickDbClient>(...)` and register additional adapters explicitly.

## `createDbClient()`

Lower-level entry — most adopters use `kickDbAdapter()` instead, which wraps this.

```ts
const db = createDbClient({
  schema,
  dialect: pgDialect({ pool }),
  events: true,
  slowQueryThresholdMs: 100,
})
```

### `CreateDbClientOptions`

| Option                 | Type                                | Description                                                                                                                         |
| ---------------------- | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `schema`               | `TSchema`                           | Schema record — used for type inference                                                                                             |
| `dialect`              | `Dialect`                           | A dialect handle from a peer adapter (e.g. `pgDialect({ pool })`), or any Kysely dialect                                            |
| `dialectTag`           | `'postgres' \| 'mysql' \| 'sqlite'` | Which SQL `dialect` speaks, for a dialect kick/db can't place ([Drivers](../guide/database/drivers.md#serverless-and-edge-drivers)) |
| `events`               | `boolean`                           | Enable lifecycle event emission. Zero-overhead when off                                                                             |
| `slowQueryThresholdMs` | `number \| null`                    | Fire `slowQuery` above this duration                                                                                                |
| `bus`                  | `KickEventBus`                      | Republish to DevTools event bus                                                                                                     |
| `plugins`              | `KyselyPlugin[]`                    | Query-builder plugins (see [`safeNullComparison()`](#safenullcomparison))                                                           |

Every query the client runs reports driver failures as [typed errors](#errors) — `UniqueViolationError`, `SerializationFailureError`, … — with the driver's error as `cause`.

## `KickDbClient`

The injected handle. Provides lifecycle events, transactions, savepoints, and `$extends`, on top of a typed query-builder surface.

```ts
interface KickDbClient<DB = RegisteredDB> {
  readonly qb: QueryBuilder<DB> // advanced escape hatch
  readonly dialect: 'postgres' | 'sqlite' | 'mysql'

  selectFrom: QueryBuilder<DB>['selectFrom']
  insertInto: QueryBuilder<DB>['insertInto']
  updateTable: QueryBuilder<DB>['updateTable']
  deleteFrom: QueryBuilder<DB>['deleteFrom']

  readonly query: QueryNamespace<DB> // relational layer — see below

  on(event, listener): this // lifecycle events
  off(event, listener): this

  transaction<T>(fn): Promise<T>
  transaction<T>(opts: TransactionOptions, fn): Promise<T>

  savepoint<T>(fn): Promise<T>
  afterCommit(fn: () => unknown): Promise<void>
  readonly inTransaction: boolean

  $extends(ext): ExtendedClient // per-table methods

  destroy(): Promise<void>
}
```

### Lifecycle events

Subscribe via `db.on(event, listener)`. Events fire when `events: true` on the client.

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

```ts
db.on('slowQuery', ({ sql, durationMs }) => {
  logger.warn({ sql, durationMs }, 'slow query')
})

db.on('queryError', ({ error, sql, parameters }) =>
  Sentry.captureException(error, { extra: { sql, parameters } }),
)
```

### Transactions + savepoints

Inside `transaction(fn)` the plain client joins the transaction too — code holding the injected `db` takes part without being handed `tx`. Full guide: [Queries → Transactions](../guide/database/transactions.md).

```ts
await db.transaction(async () => {
  await usersRepo.create({ email }) // uses db internally — same transaction
  await db.afterCommit(() => mailer.sendWelcome(email)) // after COMMIT; dropped on rollback
})

await db.transaction({ isolation: 'serializable', retry: true }, async () => { ... })

await db.transaction({ nested: 'savepoint' }, async () => { ... }) // inside an open one

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
| `retry`     | `boolean \| number \| { attempts, baseDelayMs?, maxDelayMs? }`                  | Run again on `retryable` errors (serialization failure, deadlock); `true` = 3 attempts, jittered exponential backoff |

`afterCommit(fn)` runs `fn` after the commit, drops it on rollback (including a rolled-back savepoint), and runs it at once outside a transaction; a failing hook is reported, not thrown. `inTransaction` says whether the current call chain is inside one.

## Schema DSL

### `table(name, columns, secondary?)`

```ts
const posts = table(
  'posts',
  {
    id: serial().primaryKey(),
    authorId: integer()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    title: varchar(200).notNull(),
    body: text().notNull(),
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

The constraints builder returns any mix of `index()`, `unique()`, `check(name, expression)` and one `primaryKey(name?).on(...)` — a composite or named key, in key order (use it or a column's `.primaryKey()`, not both). See [Schema → Primary keys and CHECK constraints](../guide/database/constraints.md#primary-keys-and-check-constraints).

The same table can be declared as a class or with a fluent builder — `tableFromClass`, `TableBase`, `defineTable` ([Table Forms](../guide/db-table-forms.md)) — and validated with `insertSchema` / `selectSchema` / `updateSchema` from `@forinda/kickjs-db/schema` ([Validation from Tables](../guide/db-table-schemas.md)).

### Column constructors

Cross-dialect (live on package root):

`serial`, `bigSerial`, `smallSerial`, `integer`, `bigint({ mode? })`, `smallint`, `decimal(p?, s?, { mode? })`, `numeric(p?, s?, { mode? })`, `real`, `doublePrecision`, `varchar(n)`, `char(n)`, `text`, `boolean`, `timestamp`, `timestamptz`, `date`, `time`, `interval`, `uuid`, `json<T>()`, `jsonb<T>()`, `bytea`. Arrays via `.array()`.

Modifiers: `.notNull()`, `.primaryKey()`, `.unique()`, `.default(value)`, `.defaultNow()` (timestamps), `.defaultRandom()` (uuid), `.references(() => other.column, { onDelete, onUpdate })`, `.comment(text)`, `.$defaultFn(fn)` (computed per inserted row), `.$onUpdate(fn)` (computed per update). Table comment: `table(name, columns, { comment, constraints })`.

PG-only types live at `@forinda/kickjs-db/pg`: `tsvector`, `vector(N)`, `halfvec(N)`, `point`, `geometry(type?, srid?)`, `macaddr`, `macaddr8`, `citext`, `money`, `inet`, `cidr`, `xml`. MySQL-only at `@forinda/kickjs-db/mysql`: `mysqlEnum(...values)`, `unsigned(col)`, `tinyint`, `mediumint`, `datetime(fsp?)`.

### `relations()`

```ts
import { relations } from '@forinda/kickjs-db'

export const usersRelations = relations(users, ({ many }) => ({
  posts: many(posts),
}))

export const postsRelations = relations(posts, ({ one }) => ({
  author: one(users, { fields: [posts.authorId], references: [users.id] }),
}))
```

For multi-FK schemas, tag with `relationName: 'foo'` on both sides to disambiguate.

### `customType<T>()`

Adopter-defined column type with driver mapper:

```ts
import { customType } from '@forinda/kickjs-db'

const encrypted = customType<string>({
  dataType: () => 'text',
  toDriver: (v) => encrypt(v),
  fromDriver: (v) => decrypt(v as string),
})
```

See [`docs/guide/db-extensions.md`](../guide/db-extensions.md) for the full mapper signature.

### `pgEnum()`

PostgreSQL-only ENUM type. See [Schema Types guide](../guide/db-schema-types.md#postgresql-enums).

### `pgSchema(name)`

Declare a PostgreSQL named schema and hang tables off it. Imported from the
`/pg` subpath.

```ts
import { pgSchema } from '@forinda/kickjs-db/pg'
import { table, serial, varchar } from '@forinda/kickjs-db'

const billing = pgSchema('billing')

const invoices = billing.table('invoices', {
  id: serial().primaryKey(),
  ref: varchar(32).notNull(),
})

const users = table('users', { id: serial().primaryKey() }) // default search_path
```

Generates:

```sql
CREATE SCHEMA IF NOT EXISTS "billing";
CREATE TABLE "billing"."invoices" ( ... );
CREATE TABLE "users" ( ... );
```

and keys the row type by the qualified name, which Kysely reads as
schema-qualified:

```ts
type DB = KickDbSchema // { 'billing.invoices': {...}, users: {...} }

await db.selectFrom('billing.invoices').selectAll().execute()
```

Every generated statement for the table is qualified — `CREATE`/`DROP`/`ALTER
TABLE`, `CREATE INDEX`, `DROP INDEX` (whose name resolves through
`search_path`, so it needs the qualifier), and any `REFERENCES` pointing at it.

**Two schemas may hold same-named tables.** Snapshot keys are the qualified
name, so `billing.events` and `audit.events` never collide.

**`pgSchema('public')` collapses to no schema.** PG puts `public` on the
default `search_path`, so `pgSchema('public').table('users', …)` and
`table('users', …)` name the same physical table. Treating them as different
snapshot keys would make the diff emit `DROP TABLE users` + `CREATE TABLE
public.users`, so `public` is normalised away in both the runtime value and
the row-type key.

**Schemas are never dropped.** There is no `dropSchema` change. A schema can
hold objects this app never declared — another service's tables, extensions,
views — so a `DROP SCHEMA` inferred from "no table references it any more"
could destroy data the diff never saw. Down migrations leave the emptied
schema in place for an operator to remove deliberately.

::: warning PostgreSQL only
On MySQL a "schema" _is_ a database and SQLite has none (only `ATTACH`
aliases), so the qualified identifiers would mean something different.
Declaring a schema and then diffing against either dialect throws at snapshot
time, before any DDL is written.
:::

::: tip Introspection scope
`kick db pull` / drift detection still read a single schema — the one set via
`pgAdapter({ schema })`, default `public`. Tables you declare in another schema
are created and migrated correctly, but will not be compared against the live
database. Multi-schema introspection is not implemented yet.
:::

## Query API

Three layers, all mix freely on the same `KickDbClient`.

### Layer 1 — Typed query builder

```ts
await db.selectFrom('users').where('email', '=', 'x@y.z').selectAll().executeTakeFirst()
await db.insertInto('posts').values({ authorId: 1, title: 't', body: 'b' }).returningAll().execute()
await db.updateTable('users').set({ name: 'X' }).where('id', '=', 1).executeTakeFirst()
await db.deleteFrom('posts').where('id', '=', 5).execute()
```

Inferred column types end-to-end from your schema — `name` autocompletes against the table's columns, the `'='` operator's right-hand side is typed against the column's TS type, etc.

### Layer 2 — Expressions and safe `LIKE`

Compound conditions use Kysely's expression builder:

```ts
await db
  .selectFrom('users')
  .where((eb) => eb.and([eb('isActive', '=', true), eb('signupCount', '>', 5)]))
  .selectAll()
  .execute()
```

User input in a `LIKE` pattern goes through `likePattern(input, mode)` (or `escapeLike(input)`), which escapes `%`, `_` and `\` so the text matches literally:

```ts
import { sql } from 'kysely'
import { likePattern } from '@forinda/kickjs-db'

// Postgres / MySQL — backslash is the default escape character
await db
  .selectFrom('users')
  .where('email', 'like', likePattern(search, 'contains'))
  .selectAll()
  .execute()

// SQLite has no default escape character — say it
await db
  .selectFrom('users')
  .where(sql<boolean>`email like ${likePattern(search, 'contains')} escape '\'`)
  .selectAll()
  .execute()
```

`mode` is `'contains'` (default), `'startsWith'`, `'endsWith'` or `'exact'`.

### Layer 3 — Relational queries

```ts
await db.query.users.findMany({
  where: (u, { eq }) => eq(u.isActive, true),
  with: {
    posts: {
      where: (p, { isNotNull }) => isNotNull(p.publishedAt),
      limit: 5,
    },
  },
  orderBy: (u, { desc }) => desc(u.createdAt),
  limit: 20,
  signal: ctx.signal,
})
```

Single round trip, JSON aggregation per dialect. See [Relational Queries guide](../guide/db-relational-query.md).

#### `FindManyOptions` / `FindFirstOptions` / `FindUniqueOptions`

| Option     | Type                                    | Description                                                          |
| ---------- | --------------------------------------- | -------------------------------------------------------------------- |
| `where`    | `(t, eb) => Expression<boolean>`        | Filter callback — receives the row proxy + an expression-builder API |
| `orderBy`  | `(t, eb) => Expression \| Expression[]` | Sort callback                                                        |
| `limit`    | `number`                                | Row cap                                                              |
| `with`     | `{ [relation]: true \| NestedOptions }` | Eager-load relations declared via `relations()`                      |
| `signal`   | `AbortSignal`                           | Request-scoped cancellation — see below                              |
| `maxDepth` | `number`                                | Max relational-nesting depth (default 4)                             |

### `signal?: AbortSignal` — request-scoped cancellation

When the signal fires, the in-flight query short-circuits with `RelationalQueryCancelledError`. Already-aborted signals reject before any DB round trip.

```ts
@Get('/:id/full')
async showFull(ctx: RequestContext) {
  const row = await this.db.query.tasks.findUnique({
    where: (_t, eb) => eb('id', '=', ctx.params.id),
    with: { comments: true, assignees: true, labels: true },
    signal: ctx.signal,        // ← cancels on client disconnect / timeout
  })
  return row ? ctx.json(row) : ctx.notFound()
}
```

`RequestContext.signal` is provided by `@forinda/kickjs` ≥5.6.0.

Cancellation is JS-side on every dialect: the promise rejects at once, but a query already sent keeps running on the database until it finishes and its connection returns to the pool (PostgreSQL, MySQL). SQLite runs synchronously, so the signal can only stop work before a statement starts. For true server-side cancellation of a long PostgreSQL or MySQL query, call Kysely directly through `db.qb` with `inflightQueryAbortStrategy: 'cancel query'`.

## Plugins

`createDbClient({ plugins: [...] })` accepts plugin objects that mutate queries before execution.

### `safeNullComparison()`

Pass null comparisons safely: `eb('col', '=', null)` compiles to `IS NULL` instead of the silently-false `= NULL`.

```ts
import { createDbClient, safeNullComparison } from '@forinda/kickjs-db'

const db = createDbClient({
  schema,
  dialect: pgDialect({ pool }),
  plugins: [safeNullComparison()],
})

await db.selectFrom('users').where('deletedAt', '=', null).selectAll().execute()
// → SQL: select * from "users" where "deletedAt" is null
```

Spec-compliant across every dialect kickjs-db supports — PG, MSSQL, MySQL, SQLite. Opt-in; the default client chain stays untouched.

## Migration API

### `diff(prev, next)` / `invertChanges(forward)` / `emitPg` / `emitMysql` / `emitSqlite`

In-memory diff engine + SQL emitter, exposed for adopters building custom migration tooling.

```ts
import { diff, invertChanges, emitPg } from '@forinda/kickjs-db'
import type { SchemaSnapshot } from '@forinda/kickjs-db'

const forward = diff(prevSnapshot, nextSnapshot)
// → ChangeSet (createTable, dropColumn, addIndex, …)

const reverse = invertChanges(forward)
// → reversed ChangeSet; the runner refuses to apply ambiguous reverses
//   in non-dev unless reviewed; see `hasAmbiguousReverse(forward)`

const sql = emitPg(forward)
// → up.sql text

// MySQL, and SQLite — which rebuilds tables for what ALTER TABLE can't do,
// so it needs both snapshots
emitMysql(forward)
emitSqlite(forward, { from: prevSnapshot, to: nextSnapshot })
```

Change kinds include `alterPrimaryKey`, `addCheck` and `dropCheck`; a key change is emitted around the column changes — the old key dropped first, the new one added after columns exist.

### `introspectPg` / `introspectMysql` / `introspectSqlite`

Reverse direction: live database → `SchemaSnapshot`. Powers the `kick db introspect` command and drift detection.

```ts
import { introspectPg } from '@forinda/kickjs-db'
import pg from 'pg'

const client = new pg.Client({ connectionString })
await client.connect()
const snapshot = await introspectPg(client, { schema: 'public' })

// await introspectMysql(connection, { excludeTables })   — async
// introspectSqlite(database, { excludeTables })          — better-sqlite3 / bun:sqlite handle, sync
// await introspectSqliteAsync((sql, params) => rows, …)  — any async driver (libsql, D1)
```

### `checkDrift(live, expected, behavior)` / `reviewMigration(dir, id)`

`checkDrift` compares an introspected snapshot with the last applied one and, for `behavior: 'error'`, throws `MigrationDriftError` listing what differs (`'warn'` logs, `'ignore'` skips). Primary keys are compared by columns; CHECK constraints aren't compared. `reviewMigration(migrationsDir, id)` marks a generated migration reviewed — what `kick db migrate review <id>` runs.

### `migrateLatest()` / `migrateUp()` / `migrateDown()` / `migrateRollback()` / `migrateStatus()`

Runner entry points — called by the CLI but also usable from custom scripts.

| Function                                                      | Behaviour                                 |
| ------------------------------------------------------------- | ----------------------------------------- |
| `migrateLatest({ adapter, migrationsDir, confirmEnumDrop? })` | Apply all pending in a new batch          |
| `migrateUp({ adapter, migrationsDir, confirmEnumDrop? })`     | Apply the next single pending             |
| `migrateDown({ adapter, migrationsDir })`                     | Reverse the most recent applied           |
| `migrateRollback({ adapter, migrationsDir })`                 | Reverse the entire last batch as one unit |
| `migrateStatus({ adapter, migrationsDir })`                   | Print applied + pending entries           |

Each returns a typed summary (`AppliedSummary`, `ReversedSummary`, `RollbackSummary`, `StatusEntry[]`).

The `adapter` argument implements the `MigrationAdapter` interface and is dialect-specific (`pgAdapter()`, `sqliteAdapter()`, `mysqlAdapter()`, or `asyncSqliteAdapter({ driver })` for libsql/Turso and Cloudflare D1, with `libsqlDriver(client)` / `d1Driver(db)` from `@forinda/kickjs-db/sqlite`). For tests, `MemoryMigrationAdapter` is available.

### `generate(options)`

Programmatic equivalent of `kick db generate <name>` — produces `up.sql` + `down.sql` + `snapshot.json` + `meta.json` from the schema-vs-last-applied diff.

```ts
import { generate } from '@forinda/kickjs-db'

const result = await generate({
  name: 'add_users',
  config, // from resolveDbConfig()
  cwd,
  empty: false,
  detectCompositeRefs, // optional PG composite-type gate
})
```

## Errors

Hierarchy rooted at `KickDbError`. All carry `.code`, `.cause`, and (where applicable) `.sql` + `.parameters`.

```text
KickDbError                         base
├── DatabaseError                   a failure the database reported — .dialect, .driverCode,
│   │                               .constraint, .table, .columns, .detail, .cause (driver error)
│   ├── UniqueViolationError        duplicate unique / primary key — .status = 409
│   ├── ForeignKeyViolationError
│   ├── CheckViolationError
│   ├── NotNullViolationError
│   ├── SerializationFailureError   .retryable = true
│   ├── DeadlockError               .retryable = true
│   └── ConnectionError
├── TransactionFinishedError        a query ran after its transaction finished (un-awaited work)
├── RemovedValueAsDefaultError      pgEnum value being removed is still a column DEFAULT
├── RelationalQueryCancelledError   AbortSignal fired during db.query.*
├── RelationalQueryUnknownRelationError
├── RelationalQueryAmbiguousRelationNameError
├── RelationalQueryMissingInverseError
├── RelationalQueryDepthError
├── RelationalQueryAliasCollisionError
├── RelationalQueryNotSupportedError
├── CompositeEnumReferenceError     pgEnum value-removal blocked by composite type using the enum
└── MigrationError
    ├── MigrationDriftError         introspected DB ≠ last applied snapshot
    ├── MigrationLockError          another migration in progress
    ├── MigrationHashError          journal hash mismatch — tampered or corrupt
    ├── UnreviewedMigrationError    reviewed: false in non-dev
    └── MigrationEnumDropError      missing --confirm-enum-drop on a KICK ENUM REMOVE migration
```

`translateDbError(err, dialect)` turns a raw driver error into one of the `DatabaseError` classes — for drivers you call directly; the client already does it. `SqliteRebuildRequiredError` (not a `KickDbError`) means `emitSqlite` was asked for a table rebuild without the snapshots to build it. Guide: [Queries → Errors](../guide/database/errors.md).

## Snapshot types

Type-level representation of a schema. Returned by `extractSnapshot()` / `introspectPg()`, consumed by `diff()` / `emitPg()`.

```ts
import type {
  Dialect,
  FkAction,
  ColumnSnapshot,
  IndexSnapshot,
  ForeignKeySnapshot,
  CheckSnapshot,
  TableSnapshot,
  EnumSnapshot,
  SchemaSnapshot,
} from '@forinda/kickjs-db'
```

`SchemaSnapshot` is `{ version: 1, dialect, tables, enums?, relations? }`. JSON-serializable.

## Type-only helpers

| Export                    | Use                                                                                                                       |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `SchemaToTypes<S>`        | Derive the database type shape from a schema literal — `type KickDb = SchemaToTypes<typeof schema>`                       |
| `KickDbRegister`          | Augmentable module — the kick/db typegen plugin writes `KickDbRegister['db']` so the bare `KickDbClient` widens correctly |
| `KickDbRelationsRegister` | Augmentable — keys for `db.query.X.findMany({ with: { ... } })` autocomplete                                              |
| `RegisteredDB`            | Resolves to `KickDbRegister['db']` for the bare client                                                                    |
| `ReadonlyKysely<DB>`      | Read-only narrowed handle — see [narrowing guide](../guide/db-relational-query.md#narrowing-the-client)                   |

## CLI commands

The CLI lives at `@forinda/kickjs-cli` and provides the commands below (also available standalone as the `kickjs-db` binary). `dbCliPlugin` from `@forinda/kickjs-db/cli` registers them on `kick`, and its typegen half — also exported as `kickDbTypegen` — keeps `KickDbRegister` up to date from your schema.

### `kick db generate <name>`

Generate a migration from the schema diff vs the last applied snapshot.

| Flag                  | Description                                                                   |
| --------------------- | ----------------------------------------------------------------------------- |
| `-c, --config <path>` | Path to `kick.config.ts` (default: `kick.config.ts`)                          |
| `-e, --empty`         | Skip diff; create an empty migration shell for data migrations / freeform SQL |

Writes `db/migrations/<timestamp>_<name>/{up.sql, down.sql, snapshot.json, meta.json}`. The SQL files open with an immutable `-- Generated by @forinda/kickjs-db vX.Y.Z` banner; review state lives in `meta.json` (`reviewed: false`). Run `kick db migrate review <id>` before applying in non-dev.

### `kick db migrate latest`

Apply every pending migration in a new batch. Acquires the `kick_migrations_lock` table to prevent concurrent runs.

| Flag                  | Description                                                                  |
| --------------------- | ---------------------------------------------------------------------------- |
| `-c, --config <path>` | Path to `kick.config.ts`                                                     |
| `--confirm-enum-drop` | Required when applying a migration carrying the `-- KICK ENUM REMOVE` header |

### `kick db migrate up`

Apply the next single pending migration. Same batch number as `latest`.

| Flag                  | Description              |
| --------------------- | ------------------------ |
| `-c, --config <path>` | Path to `kick.config.ts` |
| `--confirm-enum-drop` | See above                |

### `kick db migrate down`

Reverse the most recent applied migration (single migration, not the whole batch).

### `kick db migrate rollback`

Reverse the entire last batch as a single transactional unit.

### `kick db migrate status`

Print a table of applied + pending migrations with their batch numbers, hashes, and reviewed flags.

### `kick db migrate review <id>`

Mark a generated migration reviewed after reading its SQL — required before `migrate latest` / `up` applies it outside development.

### `kick db introspect`

Read the live database and generate / dump a `SchemaSnapshot`. Use for bootstrapping from an existing DB or recovering from drift.

| Flag                  | Description                                                            |
| --------------------- | ---------------------------------------------------------------------- |
| `-c, --config <path>` | Path to `kick.config.ts`                                               |
| `--out <path>`        | TS output file (defaults to `db.schemaPath` from config)               |
| `--json`              | Print raw `SchemaSnapshot` JSON to stdout instead of writing TS source |

```bash
kick db introspect --out src/db/schema.ts          # write TS schema
kick db introspect --json | jq '.tables | keys'    # inspect raw snapshot
```

## Exports

Schema DSL (all from package root): `table`, `relations`, `index`, `unique`, `primaryKey`, `check`, `selfRef`, `fk`, `link`, `tableFromClass`, `TableBase`, `defineTable`, `Rule`, `customType`, `CustomColumnBuilder`, `serial`, `bigSerial`, `smallSerial`, `integer`, `bigint`, `smallint`, `decimal`, `numeric`, `real`, `doublePrecision`, `varchar`, `char`, `text`, `boolean`, `timestamp`, `timestamptz`, `date`, `time`, `interval`, `uuid`, `json`, `jsonb`, `bytea`.

Client + DI: `createDbClient`, `kickDbAdapter`, `DB_PRIMARY`, `DB_REPLICA`, `DB_CLIENT`, type-only `KickDbClient`, `CreateDbClientOptions`, `KickDbAdapterConfig`, `MigrationsOnBoot`.

Query: `db.query.X.{findMany, findFirst, findUnique}`; type-only `FindManyOptions`, `FindManyRow`, `WithClause`, `QueryNamespace`, `TableQueryNamespace`, `KickDbRelationsRegister`, `RegisteredRelations`, `TableRelations`, `RelationMapEntry`, `ResolvedRelation`, `ResolvedRelations`.

Lifecycle events and transactions: type-only `KickDbClientEvents`, `QueryEvent`, `QueryErrorEvent`, `BeforeQueryEvent`, `TransactionEvent`, `TransactionOptions`, `TransactionRetryEvent`, `TransactionRollbackEvent`.

Query helpers: `escapeLike`, `likePattern`.

Plugins: `safeNullComparison`.

Migration: `diff`, `invertChanges`, `hasAmbiguousReverse`, `emitPg`, `emitMysql`, `emitSqlite`, `introspectPg`, `introspectMysql`, `introspectSqlite`, `reviewMigration`, `extractSnapshot`, `renderSchemaSource`, `migrateLatest`, `migrateUp`, `migrateDown`, `migrateRollback`, `migrateStatus`, `generate`, `resolveDbConfig`, `MemoryMigrationAdapter`, `migrationsTableDdl`, `lockTableDdl`, `KICK_MIGRATIONS_TABLE`, `KICK_LOCK_TABLE`, `readJournal`, `appendJournalEntry`, `computeMigrationHash`, `verifyMigrationHash`, `parseEnumDropHeader`, `enforceEnumDropGate`, `checkDrift`, `detectCompositeReferences`.

Errors: `KickDbError`, `TransactionFinishedError`, `DatabaseError`, `UniqueViolationError`, `ForeignKeyViolationError`, `CheckViolationError`, `NotNullViolationError`, `SerializationFailureError`, `DeadlockError`, `ConnectionError`, `translateDbError`, `SqliteRebuildRequiredError`, `RemovedValueAsDefaultError`, `RelationalQueryCancelledError`, `RelationalQueryUnknownRelationError`, `RelationalQueryAmbiguousRelationNameError`, `RelationalQueryMissingInverseError`, `RelationalQueryDepthError`, `RelationalQueryAliasCollisionError`, `RelationalQueryNotSupportedError`, `CompositeEnumReferenceError`, `MigrationError`, `MigrationDriftError`, `MigrationLockError`, `MigrationHashError`, `UnreviewedMigrationError`, `MigrationEnumDropError`.

Types: `Dialect`, `FkAction`, `ColumnSnapshot`, `IndexSnapshot`, `ForeignKeySnapshot`, `CheckSnapshot`, `TableSnapshot`, `EnumSnapshot`, `SchemaSnapshot`, `RelationSnapshot`, `SchemaToTypes`, `SchemaToRelationsRegister`, `KickDbRegister`, `RegisteredDB`, `ReadonlyKysely`.

Subpaths:

- `@forinda/kickjs-db/pg` — PG-only column types (`tsvector`, `vector`, `halfvec`, `point`, `geometry`, `macaddr`, `citext`, `money`, `inet`, `cidr`, `xml`), `pgSchema`, `pgDialect`, `pgAdapter`.
- `@forinda/kickjs-db/mysql` — `mysqlDialect`, `mysqlAdapter`, and MySQL column types (`mysqlEnum`, `unsigned`, `tinyint`, `mediumint`, `datetime`).
- `@forinda/kickjs-db/sqlite` — `sqliteDialect`, `sqliteAdapter`, and `asyncSqliteAdapter` with `libsqlDriver` / `d1Driver`.
- `@forinda/kickjs-db/schema` — `insertSchema`, `selectSchema`, `updateSchema` (each returns a schema with `safeParse` and `toJsonSchema()`), and the row types `InferSelect` / `InferInsert`.
- `@forinda/kickjs-db/cli` — `dbCliPlugin`, `kickDbTypegen`, config helpers.
- `@forinda/kickjs-db/devtools-events` — the `db:*` event types the DevTools Database tab reads.
