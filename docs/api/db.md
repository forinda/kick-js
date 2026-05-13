# @forinda/kickjs-db

KickJS-native ORM — code-first schema, reversible migrations, multi-dialect SQL builder. Snapshot-diff migration engine, a single-round-trip relational query layer, lifecycle hooks, and DI integration.

Pair with a dialect adapter package — [`@forinda/kickjs-db-pg`](./db-pg.md), [`@forinda/kickjs-db-sqlite`](./db-sqlite.md), or [`@forinda/kickjs-db-mysql`](./db-mysql.md).

## Installation

```bash
# Using the KickJS CLI (recommended)
kick add db

# Manual install — pick the adapter for your dialect
pnpm add @forinda/kickjs-db @forinda/kickjs-db-pg pg
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
import { pgAdapter, pgDialect } from '@forinda/kickjs-db-pg'

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

| Option                 | Type             | Description                                                               |
| ---------------------- | ---------------- | ------------------------------------------------------------------------- |
| `schema`               | `TSchema`        | Schema record — used for type inference                                   |
| `dialect`              | `Dialect`        | A dialect handle from a peer adapter (e.g. `pgDialect({ pool })`)         |
| `events`               | `boolean`        | Enable lifecycle event emission. Zero-overhead when off                   |
| `slowQueryThresholdMs` | `number \| null` | Fire `slowQuery` above this duration                                      |
| `bus`                  | `KickEventBus`   | Republish to DevTools event bus                                           |
| `plugins`              | `KyselyPlugin[]` | Query-builder plugins (see [`safeNullComparison()`](#safenullcomparison)) |

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
  transaction<T>(opts, fn): Promise<T>

  savepoint<T>(fn): Promise<T>

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

```ts
db.on('slowQuery', ({ sql, durationMs }) => {
  logger.warn({ sql, durationMs }, 'slow query')
})

db.on('queryError', ({ error, sql, parameters }) =>
  Sentry.captureException(error, { extra: { sql, parameters } }),
)
```

### Transactions + savepoints

```ts
await db.transaction(async (tx) => {
  const user = await tx.insertInto('users').values({ email }).returningAll().executeTakeFirstOrThrow()
  await tx.insertInto('profiles').values({ userId: user.id }).execute()
})

await db.transaction({ isolation: 'serializable' }, async (tx) => { ... })

await tx.savepoint(async (sp) => {
  await sp.insertInto('audit_log').values({ ... }).execute()
  throw new Error('rollback savepoint, keep outer tx alive')
})
```

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
  }),
)
```

### Column constructors

Cross-dialect (live on package root):

`serial`, `bigSerial`, `smallSerial`, `integer`, `bigint`, `smallint`, `decimal`, `numeric`, `real`, `doublePrecision`, `varchar(n)`, `char(n)`, `text`, `boolean`, `timestamp`, `timestamptz`, `date`, `time`, `interval`, `uuid`, `json<T>()`, `jsonb<T>()`, `bytea`. Arrays via `.array()`.

Modifiers: `.notNull()`, `.primaryKey()`, `.unique()`, `.default(value)`, `.defaultNow()` (timestamps), `.defaultRandom()` (uuid), `.references(() => other.column, { onDelete, onUpdate })`.

PG-only types live at `@forinda/kickjs-db/pg`: `tsvector`, `vector(N)`, `citext`, `money`, `inet`, `cidr`, `xml`.

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

### Layer 2 — Operator helpers

```ts
import { eq, and, or, gt, lt, like, ilike, inArray, isNull } from '@forinda/kickjs-db'

await db
  .selectFrom('users')
  .where(and(eq(users.isActive, true), gt(users.signupCount, 5)))
  .selectAll()
  .execute()
```

Thin wrappers that compose into more readable filters when conditions get hairy.

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

`RequestContext.signal` is provided by `@forinda/kickjs` ≥5.6.0. See [`spec-abortsignal-threading.md`](../db/spec-abortsignal-threading.md) for cross-dialect cancellation semantics.

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

### `diff(prev, next)` / `invertChanges(forward)` / `emitPg(changes)`

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
```

### `introspectPg(client, options?)`

Reverse direction: live PG → `SchemaSnapshot`. Powers the `kick db introspect` command.

```ts
import { introspectPg } from '@forinda/kickjs-db'
import pg from 'pg'

const client = new pg.Client({ connectionString })
await client.connect()
const snapshot = await introspectPg(client, { schema: 'public' })
```

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

The `adapter` argument implements the `MigrationAdapter` interface and is dialect-specific (`pgAdapter()`, `sqliteAdapter()`, `mysqlAdapter()`). For tests, `MemoryMigrationAdapter` is available.

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

The CLI lives at `@forinda/kickjs-cli` and provides:

### `kick db generate <name>`

Generate a migration from the schema diff vs the last applied snapshot.

| Flag                  | Description                                                                   |
| --------------------- | ----------------------------------------------------------------------------- |
| `-c, --config <path>` | Path to `kick.config.ts` (default: `kick.config.ts`)                          |
| `-e, --empty`         | Skip diff; create an empty migration shell for data migrations / freeform SQL |

Writes `db/migrations/<timestamp>_<name>/{up.sql, down.sql, snapshot.json, meta.json}`. Each file is headed `-- REVIEWED: false`; flip the flag in `meta.json` (or via a review CLI) before applying in non-dev.

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

Schema DSL (all from package root): `table`, `relations`, `index`, `unique`, `primaryKey`, `customType`, `CustomColumnBuilder`, `serial`, `bigSerial`, `smallSerial`, `integer`, `bigint`, `smallint`, `decimal`, `numeric`, `real`, `doublePrecision`, `varchar`, `char`, `text`, `boolean`, `timestamp`, `timestamptz`, `date`, `time`, `interval`, `uuid`, `json`, `jsonb`, `bytea`.

Client + DI: `createDbClient`, `kickDbAdapter`, `DB_PRIMARY`, `DB_REPLICA`, `DB_CLIENT`, type-only `KickDbClient`, `CreateDbClientOptions`, `KickDbAdapterConfig`, `MigrationsOnBoot`.

Query: `db.query.X.{findMany, findFirst, findUnique}`; type-only `FindManyOptions`, `FindManyRow`, `WithClause`, `QueryNamespace`, `TableQueryNamespace`, `KickDbRelationsRegister`, `RegisteredRelations`, `TableRelations`, `RelationMapEntry`, `ResolvedRelation`, `ResolvedRelations`.

Lifecycle events: type-only `KickDbClientEvents`, `QueryEvent`, `QueryErrorEvent`, `BeforeQueryEvent`, `TransactionEvent`, `TransactionRollbackEvent`.

Plugins: `safeNullComparison`.

Migration: `diff`, `invertChanges`, `hasAmbiguousReverse`, `emitPg`, `introspectPg`, `extractSnapshot`, `renderSchemaSource`, `migrateLatest`, `migrateUp`, `migrateDown`, `migrateRollback`, `migrateStatus`, `generate`, `resolveDbConfig`, `MemoryMigrationAdapter`, `migrationsTableDdl`, `lockTableDdl`, `KICK_MIGRATIONS_TABLE`, `KICK_LOCK_TABLE`, `readJournal`, `appendJournalEntry`, `computeMigrationHash`, `verifyMigrationHash`, `parseEnumDropHeader`, `enforceEnumDropGate`, `checkDrift`, `detectCompositeReferences`.

Errors: `KickDbError`, `RemovedValueAsDefaultError`, `RelationalQueryCancelledError`, `RelationalQueryUnknownRelationError`, `RelationalQueryAmbiguousRelationNameError`, `RelationalQueryMissingInverseError`, `RelationalQueryDepthError`, `RelationalQueryAliasCollisionError`, `RelationalQueryNotSupportedError`, `CompositeEnumReferenceError`, `MigrationError`, `MigrationDriftError`, `MigrationLockError`, `MigrationHashError`, `UnreviewedMigrationError`, `MigrationEnumDropError`.

Types: `Dialect`, `FkAction`, `ColumnSnapshot`, `IndexSnapshot`, `ForeignKeySnapshot`, `CheckSnapshot`, `TableSnapshot`, `EnumSnapshot`, `SchemaSnapshot`, `RelationSnapshot`, `SchemaToTypes`, `SchemaToRelationsRegister`, `KickDbRegister`, `RegisteredDB`, `ReadonlyKysely`.

Subpath: `@forinda/kickjs-db/pg` — PG-only column types (`tsvector`, `vector`, `citext`, `money`, `inet`, `cidr`, `xml`).
