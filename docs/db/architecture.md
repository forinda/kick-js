# `@forinda/kickjs-db` — Architecture & Design Spec

> Status: Draft v1
> Date: 2026-04-27
> Owner: @forinda
> Target release: KickJS v6.0.0

A KickJS-native ORM combining the parts of Knex, Drizzle, and Prisma that solve real problems, while skipping the parts that don't.

The intersection target:

- **Knex** — explicit reversible migrations (up + down), batch rollback, lock-table concurrency safety, ergonomic CLI.
- **Drizzle** — code-first schema as the source of truth, branded-type inference, custom column type mappers, multi-driver via dialect abstraction.
- **Prisma** — `$extends`-style extensibility (model methods + computed result fields), driver adapter contract, generator-style codegen as opt-in.

Things deliberately not copied:

- Drizzle's forward-only migration story (the original motivation for this project).
- Prisma's Rust query engine (single-maintainer scope risk).
- Knex's untyped string-keyed query builder (replaced by Kysely as the typed core).

## 1. Goals & non-goals

### Goals

1. Production-grade ORM shipping with KickJS v6.0.0.
2. Multi-dialect: PostgreSQL and SQLite at v6.0; MySQL at v6.1; edge runtimes (Neon-HTTP, Cloudflare D1) at v6.2.
3. Schema-as-TypeScript (code-first), type-inferred queries, no codegen at typical use.
4. Reversible migrations with auto-emitted but explicitly-reviewed `down.sql` drafts.
5. Drift detection between live DB and last applied snapshot.
6. First-class KickJS integration: DI tokens, lifecycle adapter, Context Contributors for multi-tenant, DevTools tab, generators.
7. The first-party database layer for KickJS.

### Non-goals

- NoSQL support.
- Active-record / model classes (tables are values).
- Auto-detected N+1 (lives in a dev-time linter, not the runtime).
- DSL-level RLS (raw SQL in migrations + contributors handle `SET LOCAL`).
- GraphQL schema generation (separate package, optional).
- Custom SQL templating beyond Kysely's `sql` template tag.

## 2. Implementation strategy

**Approach: build atop Kysely.** Use [Kysely](https://kysely.dev) (MIT, mature, multi-dialect, no schema or migration tooling) as the typed query-builder core. KickJS-DB adds:

- Code-first schema DSL → Kysely-types codegen (opt-in).
- Migration engine (snapshot, diff, up/down generation, drift, batch, lock).
- Lifecycle hooks (`on('query'|'queryError'|...)`).
- `$extends({ model, result })`.
- KickJS DI / Context Contributor / DevTools integration.
- Knex-flavored ergonomics layer: `.modify()`, `tx.savepoint()`, streaming with backpressure.

Why not pure greenfield: drizzle's typed-query inference took ~2 years to harden across dialects. Re-doing that solo while also building migration + schema + extensions + multi-DB + KickJS integration is unrealistic. Kysely solves exactly the part that's a solved problem.

Why not fork drizzle: license-clean greenfield is preferred; idiom-borrowing (branded types, `customType` mapper signature) is fine and used.

## 3. Package topology

The node SQL dialects (PostgreSQL / SQLite / MySQL) ship as **subpaths of the core package** — one install plus the one driver you use. The pattern mirrors `@forinda/kickjs-schema` (`./zod` / `./valibot` / `./yup` + optional peer deps).

```text
packages/
  db/                        @forinda/kickjs-db                 (core + /pg /sqlite /mysql adapters)
  db-pg/                     @forinda/kickjs-db-pg              (deprecated shim → @forinda/kickjs-db/pg)
  db-sqlite/                 @forinda/kickjs-db-sqlite          (deprecated shim → @forinda/kickjs-db/sqlite)
  db-mysql/                  @forinda/kickjs-db-mysql           (deprecated shim → @forinda/kickjs-db/mysql)
  db-neon-http/              @forinda/kickjs-db-neon-http       (edge, v6.2)
  db-d1/                     @forinda/kickjs-db-d1              (Cloudflare D1, v6.2)
```

**Dependencies:**

- `db` core — `kysely` + `@forinda/kickjs` (peer). Drivers (`pg`, `better-sqlite3`, `mysql2`) are **optional peer deps** — the relevant subpath imports its driver lazily, so installing `@forinda/kickjs-db` never pulls all three.
- Edge adapters — driver-specific separate packages (`@neondatabase/serverless`, etc), v6.2.

**Subpath exports** (core package) — each dialect subpath ships the migration adapter + Kysely dialect, and (for PG today) the dialect-specific column types. Cross-dialect column constructors (`uuid`, `varchar`, `timestamp`, …) live on the **root** entry, not the subpaths.

- `@forinda/kickjs-db` — root: cross-dialect DSL + column constructors, client, hooks, `$extends`, `defineTenantDbContributor`.
- `@forinda/kickjs-db/pg` — `pgAdapter` + `pgDialect` **+ PG-only column types** (`tsvector`, `vector`, `citext`, `money`, `inet`, `cidr`, `xml`). Needs `pg`.
- `@forinda/kickjs-db/sqlite` — `sqliteAdapter` + `sqliteDialect`. No SQLite-specific column types today (reserved for future quirks). Needs `better-sqlite3`.
- `@forinda/kickjs-db/mysql` — `mysqlAdapter` + `mysqlDialect`. No MySQL-specific column types today (reserved for future types). Needs `mysql2`.
- `@forinda/kickjs-db/edge` — edge-safe entry; omits the migration runner, introspection, and any `node:fs`/`node:path` import path. v6.2.

**Versioning** — lockstep across all `db*` packages, matching KickJS convention. Bumped via `scripts/release.js`.

## 4. Schema DSL

Code-first. A single `schema.ts` (or aggregated multi-file export) is the source of truth for type inference, migration diffing, and introspection roundtrip.

```ts
import {
  table,
  serial,
  varchar,
  text,
  timestamp,
  boolean,
  integer,
  json,
  uuid,
  relations,
  primaryKey,
  index,
  unique,
} from '@forinda/kickjs-db'

export const users = table(
  'users',
  {
    id: serial().primaryKey(),
    email: varchar(255).notNull().unique(),
    name: varchar(120),
    createdAt: timestamp().defaultNow().notNull(),
    isActive: boolean().default(true).notNull(),
  },
  (t) => ({
    emailIdx: index('users_email_idx').on(t.email),
  }),
)

export const posts = table(
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

export const usersRelations = relations(users, ({ many }) => ({
  posts: many(posts),
}))

export const postsRelations = relations(posts, ({ one }) => ({
  author: one(users, { fields: [posts.authorId], references: [users.id] }),
}))
```

### Column constructors (cross-dialect)

`serial`, `bigSerial`, `integer`, `bigint`, `smallint`, `decimal`, `numeric`, `real`, `doublePrecision`, `varchar`, `char`, `text`, `boolean`, `timestamp`, `timestamptz`, `date`, `time`, `interval`, `uuid`, `json`, `jsonb`, `bytea`. Arrays via `.array()`.

### Per-dialect types (subpath imports)

- `@forinda/kickjs-db/pg` — `tsvector`, `vector(384)`, `citext`, `money`, `inet`, `cidr`, `xml`.
- `@forinda/kickjs-db/sqlite` — SQLite-only quirks.
- `@forinda/kickjs-db/mysql` — `mediumtext`, `longblob`, etc.

Cross-dialect types stay in the package root; dialect-specific types are subpath-imported so adopters can't accidentally reach for a `tsvector` while targeting SQLite.

### Custom column types

Drizzle-pattern, ergonomically identical:

```ts
import { customType } from '@forinda/kickjs-db'

const encrypted = customType<string>({
  dataType: () => 'text',
  toDriver: (v) => encrypt(v),
  fromDriver: (v) => decrypt(v as string),
})
```

### Constraints, indexes, checks

Declared in the third arg to `table(...)` — the `(t) => ({ ... })` callback. Multi-column constraints sit naturally there; single-column indexes also live here (never via `.index()` on the column) so constraint names always live in one place.

### Relations

Declared separately from `table(...)`, after both tables exist. This avoids forward-reference problems with FKs and keeps the table descriptor pure data, which makes diffing simpler (relations are query-time joining sugar, not DDL).

### Type extraction

```ts
type User = typeof users.$inferSelect
type NewUser = typeof users.$inferInsert
type UserUpdate = typeof users.$inferUpdate
```

### Inference vs codegen

**Default: pure type inference.** No generation step.

**Opt-in: `kick db typegen`** emits an ambient `.d.ts` (`kickjs-db.d.ts`) declaring `KickDbSchema`. Faster cold-start in monorepos with many type instantiations. Adopters opt in via `kick.config.ts: db.typegen: true`.

## 5. Migration engine

### File layout

```
db/
  migrations/
    20260427_153012_add_users/
      up.sql
      down.sql
      snapshot.json
      meta.json           { id, name, createdAt, hash, reviewed: boolean, dialect }
    20260428_091500_add_posts/
      ...
    _journal.json
```

`_journal.json`:

```json
{
  "version": 1,
  "dialect": "postgres",
  "entries": [
    {
      "id": "20260427_153012_add_users",
      "tag": "add_users",
      "hash": "sha256:...",
      "createdAt": "..."
    }
  ]
}
```

`hash` = `sha256(up.sql + down.sql + snapshot.json)`. Tampering with applied migrations fails the integrity check at `migrate latest` time.

### Generation flow (`kick db generate <name>`)

1. Load `schema.ts` exports → produce **target snapshot** (in-memory IR).
2. Load latest committed `snapshot.json` → **previous snapshot**.
3. Diff snapshots → **change set IR** (`CreateTable`, `DropTable`, `AddColumn`, `DropColumn`, `AlterColumn`, `AddIndex`, `AddFK`, `AddCheck`, etc).
4. Compile to SQL via per-dialect emitter:
   - `up.sql` — full forward DDL.
   - `down.sql` — reverse change set, plus `-- DRAFT: review before applying` if any change is ambiguous.
5. Both files open with an immutable provenance banner (`-- Generated by @forinda/kickjs-db vX.Y.Z — review state lives in meta.json`). The review gate is `meta.json.reviewed` only — the banner never changes, so reviewing never invalidates the journal hash. The runner refuses unreviewed migrations in non-dev.
6. Write `up.sql`, `down.sql`, `snapshot.json`, `meta.json{ reviewed: false }`.
7. Print diff summary to stdout. Exit 0.

### Ambiguity policy (the drizzle complaint, solved)

For each ambiguous reverse, the down draft makes a defensible choice and surfaces it via the DRAFT marker:

| Forward change                  | Down draft                                        | Marker |
| ------------------------------- | ------------------------------------------------- | ------ |
| Drop column `email`             | `ADD COLUMN email VARCHAR(255)` (last-known type) | DRAFT  |
| Drop table                      | Re-CREATE from snapshot (no data)                 | DRAFT  |
| Type widen `varchar(50)→text`   | `ALTER COLUMN ... TYPE varchar(50)` (lossy)       | DRAFT  |
| Add NOT NULL without default    | `ALTER COLUMN ... DROP NOT NULL`                  | DRAFT  |
| Rename column                   | Renamed reverse                                   | clean  |
| Add column / index / FK / check | Drop them                                         | clean  |

**Marker enforcement.** Runner refuses to apply any migration where `meta.json.reviewed === false` unless `NODE_ENV === 'development'` _and_ `kick.config.ts: db.requireReviewedMigrations` is not `'error'`. Default `'error'` everywhere except dev. CI hook (`kick db migrate verify`) fails the build on any committed unreviewed migration.

Reviewing: `kick db migrate review <id>` flips `meta.json.reviewed` to `true`. The SQL files are untouched (immutable banner), so the journal hash stays valid; manual `meta.json` editing also works. Legacy migrations that still carry in-file `-- REVIEWED:` markers are migrated by the command (marker swap + hash re-sync).

### Runner (`kick db migrate latest`)

1. Acquire lock — `kick_migrations_lock` table, single-row, atomic upsert (`ON CONFLICT DO NOTHING RETURNING` on PG, `INSERT OR IGNORE` on SQLite, `INSERT IGNORE` on MySQL). Lock collision → exit "another migration in progress".
2. Read `kick_migrations` (id, name, hash, batch, applied_at, direction).
3. Compute pending = journal entries not in `kick_migrations`.
4. Verify each pending: hash matches stored, marker reviewed.
5. **Drift check** — introspect live DB → compare to last applied migration's `snapshot.json`. Mismatch = `MigrationDriftError` with diff. Behavior `error|warn|ignore` (default `error`).
6. Allocate new batch number = `MAX(batch) + 1`.
7. For each pending in order: open transaction (per migration; opt-out via `meta.json.transaction: false` for cases like PG `CREATE INDEX CONCURRENTLY`), run `up.sql`, insert into `kick_migrations`, commit.
8. Release lock.

### Subcommands

| Command                          | Behavior                                           |
| -------------------------------- | -------------------------------------------------- |
| `kick db migrate latest`         | Apply all pending; new batch.                      |
| `kick db migrate up`             | Apply next single pending; same batch as `latest`. |
| `kick db migrate down`           | Roll back single most recent applied.              |
| `kick db migrate rollback`       | Roll back entire last batch (one transaction).     |
| `kick db migrate rollback --all` | Roll back everything; `--force` in non-dev.        |
| `kick db migrate status`         | Print applied + pending tables.                    |
| `kick db migrate reset`          | Drop all + reapply from zero; non-prod only.       |
| `kick db migrate make <name>`    | Generate empty up/down shell (data migrations).    |
| `kick db migrate verify`         | CI hook — fail on unreviewed or hash-mismatched.   |
| `kick db migrate review <id>`    | Mark migration reviewed.                           |

### TS escape hatch

If `up.ts` exists, runner imports + calls `export default async (tx, ctx) => { ... }`. Same for `down.ts`. Used for data backfills, conditional logic during multi-step type changes. SQL files take precedence if both exist (would be a generation bug; warn).

### Boot integration

`kickDbAdapter()` does **not** auto-run migrations on app start. Explicit operator action only. Config opt-in:

```ts
adapters: [kickDbAdapter({ migrationsOnBoot: 'fail-if-pending' | 'apply' | 'ignore' })]
```

Default `'fail-if-pending'` — boot fails fast if migrations are missing. Avoids the prisma-style footgun where `migrate dev` accidentally runs in prod.

### Seeds

Knex-style. `db/seeds/*.ts`, each exports `default async (db) => { ... }`. Runner: `kick db seed run [name]`. No tracking table — idempotency is the seed author's responsibility (use `onConflict.doNothing()`). `kick db seed make <name>` scaffolds.

## 6. Client, query API, transactions

### Client construction

```ts
import { createDbClient } from '@forinda/kickjs-db'
import { pgAdapter } from '@forinda/kickjs-db-pg'
import * as schema from './db/schema'

export const db = createDbClient({
  schema,
  adapter: pgAdapter({ connectionString: env.DATABASE_URL, max: 20 }),
  log: { level: 'debug' },
  events: true,
})
```

`KickDbClient` wraps a Kysely instance. Type parameter inferred from `schema`.

### Three query layers

**Layer 1 — Kysely-shaped (the SQL surface).**

```ts
await db.selectFrom('users').where('email', '=', 'x@y.z').selectAll().limit(1).executeTakeFirst()
await db.insertInto('posts').values({ authorId: 1, title: 't', body: 'b' }).returningAll().execute()
await db.updateTable('users').set({ name: 'X' }).where('id', '=', 1).executeTakeFirst()
await db.deleteFrom('posts').where('id', '=', 5).execute()
```

Kysely's API verbatim. No re-skinning.

**Layer 2 — Schema-bound aliases (drizzle ergonomics).**

```ts
import { eq, and, gt } from '@forinda/kickjs-db'

await db.select().from(users).where(eq(users.email, 'x@y.z')).limit(1).executeTakeFirst()
await db.insert(users).values({ email: '...' }).returningAll().execute()
```

Same Kysely engine underneath. The schema export `users` is accepted in place of the string `'users'`. Operator helpers (`eq`, `and`, `or`, `gt`, `lt`, `like`, `ilike`, `inArray`, `notInArray`, `isNull`, etc.) are thin wrappers around Kysely's expression builder. Layers 1 and 2 mix freely.

**Layer 3 — Relational query (drizzle's `db.query`).**

```ts
await db.query.users.findMany({
  where: (u, { eq }) => eq(u.isActive, true),
  with: { posts: { where: (p, { isNotNull }) => isNotNull(p.publishedAt), limit: 5 } },
  orderBy: (u, { desc }) => desc(u.createdAt),
  limit: 20,
})
```

Built on layer 1; compiles to a single Kysely query with JSON aggregation per dialect (PG `json_agg`, SQLite `json_group_array`, MySQL `JSON_ARRAYAGG`). No N+1.

`findMany`, `findFirst`, `findUnique`. No mutation methods on `db.query.X` — use layers 1/2 for inserts/updates/deletes.

### Transactions

```ts
await db.transaction(async (tx) => {
  const user = await tx.insert(users).values({ email }).returningAll().executeTakeFirstOrThrow()
  await tx.insert(profiles).values({ userId: user.id }).execute()
})
```

`tx` is a fully-typed `KickDbClient` scoped to the transaction. Auto-commit on success, rollback on throw. Isolation: `db.transaction({ isolation: 'serializable' }, async (tx) => ...)`.

**Savepoints (knex-port).** `await tx.savepoint(async (sp) => { ... })` — nested rollback boundary. Throw inside = savepoint rollback only. Each savepoint gets a generated name; user can pass one.

### Conditional builder (`.modify()`-port)

```ts
const q = db.selectFrom('users').selectAll().modify(filterByActive, true).modify(orderByName, 'asc')

function filterByActive(qb, active: boolean) {
  return active ? qb.where('isActive', '=', true) : qb
}
```

Thin wrapper. DRY filter composition without inventing a parallel query DSL.

### Streaming (knex-port)

```ts
for await (const row of db.selectFrom('users').selectAll().stream()) {
  process(row)
}
```

Backed by the adapter's cursor / streaming protocol. Adapters that don't support streaming (D1, neon-http) throw `StreamingNotSupportedError`. No silent in-memory fallback.

### Lifecycle hooks

```ts
db.on('query', ({ sql, parameters, ms }) => logger.debug({ sql }, 'query'))
db.on('queryError', ({ sql, error }) => sentry.captureException(error))
db.on('beforeQuery', (event) => {
  event.sql = rewriteForRls(event.sql)
}) // mutation allowed
```

Events: `beforeQuery` (mutation point), `query`, `queryError`, `transactionStart`, `transactionCommit`, `transactionRollback`, `slowQuery`. Hooks are `(event) => void | Promise<void>`. Async hooks awaited in order. Listener errors are caught + logged; query is not aborted — except `beforeQuery` errors, which abort (since the hook is mutating).

### `$extends`

```ts
const dbX = db.$extends({
  model: {
    users: {
      async findActiveByEmail(email: string) {
        return this.findFirst({
          where: (u, { eq, and }) => and(eq(u.email, email), eq(u.isActive, true)),
        })
      },
    },
  },
  result: {
    users: {
      fullName: {
        needs: { firstName: true, lastName: true },
        compute: (u) => `${u.firstName} ${u.lastName}`,
      },
    },
  },
})

await dbX.users.findActiveByEmail('x@y.z')
const u = await dbX.query.users.findFirst({ where: (u, { eq }) => eq(u.id, 1) })
u.fullName // computed
```

- `model.<name>.<method>` — bolts methods onto `dbX.<name>` (top-level access, distinct from `dbX.query.<name>`).
- `result.<name>.<key>` — `{ needs, compute }`. `needs` declares which raw columns are required (auto-included in selection); `compute` runs post-fetch. The extended client's select-type includes `key`.
- `query` extension intentionally not supported — the `beforeQuery` hook covers that need at lower API cost and avoids the prisma footgun where users can't tell which interception layer to use.

### Deliberately not added

- Active-record patterns. Tables are values, not classes. No `user.save()`.
- Implicit relation-include defaults. Joins are explicit. Performance is predictable.
- `findOrCreate` / `firstOrCreate` magic. Compose `findFirst` + `insert`, or use `onConflict`.
- Raw-SQL helpers that interpolate without binding. `sql\`...\``template tag binds via Kysely's`sql` helper.

## 7. KickJS integration

### Adapter registration

```ts
import { bootstrap } from '@forinda/kickjs'
import { kickDbAdapter } from '@forinda/kickjs-db'
import { pgAdapter } from '@forinda/kickjs-db-pg'
import * as schema from './db/schema'

export const app = await bootstrap({
  modules,
  adapters: [
    kickDbAdapter({
      schema,
      adapter: pgAdapter({ connectionString: env.DATABASE_URL }),
      migrationsOnBoot: 'fail-if-pending',
      events: true,
    }),
  ],
})
```

`kickDbAdapter()` is a `defineAdapter()` factory:

1. **`beforeStart`** — instantiates `KickDbClient`, registers it on DI tokens, runs migration check.
2. **`shutdown`** — `db.destroy()`. Runs in cooperative shutdown (`Promise.allSettled` group; one slow flush can't block siblings).
3. **`introspect()`** — emits `{ pool: { active, idle, max }, dialect, lastMigration, eventCounts }` to DevTools.
4. **`devtoolsTabs()`** — registers a "Database" tab via `@forinda/kickjs-devtools-kit`.
5. **`contributors()`** — exposes a default contributor registering `db` on `RequestContext` for handlers that want a request-scoped reference (transactional middleware, etc).

### DI tokens

```ts
export const DB_PRIMARY = createToken<KickDbClient>('app/db/primary')
export const DB_REPLICA = createToken<KickDbClient>('app/db/replica')
export const DB_CLIENT = DB_PRIMARY // alias
```

`kickDbAdapter()` registers itself against `DB_PRIMARY` by default. Multi-DB apps register additional adapters explicitly:

```ts
adapters: [
  kickDbAdapter({
    token: DB_PRIMARY,
    schema,
    adapter: pgAdapter({ connectionString: env.PRIMARY_URL }),
  }),
  kickDbAdapter({
    token: DB_REPLICA,
    schema,
    adapter: pgAdapter({ connectionString: env.REPLICA_URL }),
  }),
]
```

Adopters define their own tokens for sharded setups:

```ts
const DB_TENANT = createToken<KickDbClient>('app/db/tenants')
adapters: [kickDbAdapter({ token: DB_TENANT, ... })]
```

Repository injection:

```ts
@Service()
class UserRepo {
  @Inject(DB_PRIMARY) private db!: KickDbClient
  @Inject(DB_REPLICA) private read!: KickDbClient

  findById(id: number) {
    return this.read.query.users.findFirst({ where: (u, { eq }) => eq(u.id, id) })
  }
  create(data: NewUser) {
    return this.db.insert(users).values(data).returningAll().executeTakeFirstOrThrow()
  }
}
```

### Multi-tenant Context Contributor

The package exports a helper. Adopters compose, not configure:

```ts
// In core:
export function defineTenantDbContributor<TKey extends string = 'db'>(opts: {
  key?: TKey
  base: KickDbClient
  resolveTenant: (ctx: RequestContext) => string | Promise<string>
  buildClient:   (tenantId: string, base: KickDbClient) => KickDbClient
}): ContextContributor

// In an adopter app:
const TenantDb = defineTenantDbContributor({
  base: db,
  resolveTenant: (ctx) => ctx.req.headers['x-tenant-id'] as string,
  buildClient:   (tid, base) => base.withSchema(`tenant_${tid}`),
})

bootstrap({ contributors: [TenantDb], ... })

@TenantDb
@Controller()
class ProjectsController {
  @Get('/:id')
  show(ctx: RequestContext) {
    const db = ctx.get('db')!     // typed against ContextMeta['db']
    return db.query.projects.findUnique({ where: (p, { eq }) => eq(p.id, ctx.params.id) })
  }
}
```

This is the canonical replacement for the deprecated `@forinda/kickjs-multi-tenant`.

### Request-scoped clients

For RLS-heavy or per-request connection-bound apps:

```ts
kickDbAdapter({ scope: 'request', tokenFactory: ... })
```

Registers under `Scope.REQUEST`. Each request gets a freshly-bound client (e.g., `SET LOCAL app.user_id = ...`). Cleaned up via `requestStore` lifecycle hook on response close.

Internally reads via `getRequestValue('db')`. Never exposes raw store APIs to user code.

### Logger integration

`KickDbClient` accepts `log: Logger | { level, logger }`. When omitted, pulls the framework Logger from DI. All query/error events route through the same framework `Logger`, module name `kickjs-db`.

### CLI generator

`@forinda/kickjs-cli` gains `--repo kickdb` for `kick g module`:

```bash
kick g module users --repo kickdb
```

Generates the standard DDD layout:

- `src/modules/users/users.schema.ts` — `table` + `relations`.
- `src/modules/users/users.repository.ts` — `@Service()` repo with `@Inject(DB_PRIMARY)`.
- `src/modules/users/users.service.ts`
- `src/modules/users/users.controller.ts`
- `src/modules/users/users.dto.ts` — Zod schemas.
- `src/modules/users/users.module.ts`

The schema file is also re-exported into `src/db/schema.ts` aggregate. Module removal (`kick rm module users`) drops both.

`kick new --repo kickdb` is the default.

### Testing helpers

`@forinda/kickjs-testing` gains:

```ts
import { createTestDb } from '@forinda/kickjs-testing'

const db = await createTestDb({ schema, dialect: 'sqlite' })
const db = await createTestDb({ schema, adapter: pgAdapter({ ... }), migrate: 'fresh' })
const db = await createTestDb({ schema, adapter: pgAdapter({ ... }), migrate: 'transactional' })
```

`migrate: 'transactional'` wraps each test in a tx that rolls back on completion (PG only; SQLite + MySQL fall back to `'fresh'`).

## 8. Error model, observability, DevTools

### Error hierarchy

```
KickDbError                         base; .code, .cause, .sql?, .parameters?
├── ConnectionError                ECONNREFUSED, pool exhausted, TLS fail
├── QueryError                     SQL execution failure (catch-all)
│   ├── UniqueViolationError       code: 'unique_violation'
│   ├── ForeignKeyViolationError   code: 'foreign_key_violation'
│   ├── NotNullViolationError      code: 'not_null_violation'
│   ├── CheckViolationError        code: 'check_violation'
│   └── SerializationError         code: 'serialization_failure' (retryable)
├── MigrationError
│   ├── MigrationDriftError
│   ├── MigrationLockError
│   ├── MigrationHashError
│   └── UnreviewedMigrationError
├── ValidationError                schema-vs-input mismatch
└── AdapterError                   adapter contract violation
```

Constraint errors expose structured detail (`constraint`, `table`, `columns`, `detail`). Driver-specific shapes are mapped inside the adapter package; core never sees them.

### Logging

Three topics through the framework `Logger`, module `kickjs-db`:

- `query` — `{ sql, parameters, ms, rowCount }`, `debug`, off in prod by default.
- `migration` — `{ id, direction, ms }`, `info`.
- `error` — full chain, `error`, always on.

`events: true` toggles the lifecycle event API; independent of log level.

### OpenTelemetry tracing (BYO SDK)

Per the v5 strategic shape (the deprecated `kickjs-otel` was replaced by BYO recipes), `kickjs-db` ships _spans_, not the SDK:

```ts
kickDbAdapter({ tracer: trace.getTracer('kickjs-db') })
```

Spans:

- `db.query` — attrs `db.system`, `db.statement` (params replaced by `?`), `db.operation`, `kickjs.dialect`, `kickjs.adapter`.
- `db.transaction` — wraps `transaction()` callback.
- `db.migration` — wraps each migration during `migrate latest`.

Adopters using BYO OTel pass `trace.getTracer('app')`. Apps without OTel pass nothing. No coupling.

### Metrics (BYO meter)

```ts
kickDbAdapter({ meter: metrics.getMeter('kickjs-db') })
```

- `kickjs_db_query_duration_ms` (histogram; `dialect`, `op`, `table`)
- `kickjs_db_pool_active` / `_idle` / `_waiting` (gauges)
- `kickjs_db_query_errors_total` (counter; `code`)
- `kickjs_db_migrations_applied_total` (counter)

Pool gauges polled on a 5s interval when `meter` provided.

### DevTools dashboard

Tab at `/_debug/db`, registered via `defineDevtoolsTab` from `@forinda/kickjs-devtools-kit`:

- **Pool** — active/idle/waiting, max, dialect, redacted host.
- **Schema** — table list → click → columns + indexes + FKs.
- **Migrations** — applied + pending tables, hash status, drift indicator. "Apply" button only when `NODE_ENV !== 'production'`.
- **Recent queries** — last 100 (only when `events: true` AND non-prod). Searchable; slow queries highlighted (default `>200ms`, configurable).
- **Live query** — text area + "EXPLAIN" / "EXECUTE". Dev only.

DevTools writes are blocked in production (UI hidden + runtime endpoint refuses on `NODE_ENV === 'production'`). Belt and suspenders.

### Slow query detection

```ts
kickDbAdapter({ slowQueryThresholdMs: 50 }) // default 200; null = disabled
```

Emits `slowQuery` event + warn-level log per query above threshold.

### Vendor integration (Sentry/Datadog/etc)

Not built-in. Documented one-liner pattern:

```ts
db.on('queryError', ({ error, sql, parameters }) =>
  Sentry.captureException(error, { extra: { sql, parameters } }),
)
```

## 9. Testing strategy

### Framework's own tests

```
packages/db/__tests__/
  unit/
    schema-dsl.test.ts
    diff-engine.test.ts
    sql-emitter.test.ts
    type-inference.test.tsx        # expectTypeOf
    extensions.test.ts
  integration/
    [pg|sqlite|mysql].migration.test.ts
    [pg|sqlite|mysql].query.test.ts
    [pg|sqlite|mysql].transaction.test.ts
    [pg|sqlite|mysql].streaming.test.ts
    [pg|sqlite|mysql].drift.test.ts
  e2e/
    app-bootstrap.test.ts
    multi-tenant.test.ts
```

**Dialect parameterization** — `describe.each` over dialect setups.

**PG + MySQL** — Testcontainers, per-job not per-test.

**SQLite** — in-memory, no container.

**Test isolation** — every integration test uses `Container.create()` (kickjs convention; never `new Container()` or `reset()+getInstance()`). Each test spins its own `KickDbClient`. Schema cleanup via `db.migrate.reset()` for heavy files; transactional rollback for chatty ones.

### Type tests (Vitest `expectTypeOf`)

Specifically guards:

- `db.query.users.findMany({ with: { posts: true } })` result includes `posts: Post[]`.
- `users.$inferInsert` — defaulted fields optional, non-defaulted NOT NULL fields required.
- `$extends({ result: { fullName: ... } })` — extended select-type includes `fullName`.
- `eq(users.id, 'string')` — type error.

These catch the inference regressions drizzle's two-year hardening had to discover the hard way.

### Adopter-facing helpers

`@forinda/kickjs-testing.createTestDb()` (signature in §7).

## 10. Introspection (`kick db introspect`)

Reverse direction: existing DB → generated `schema.ts`.

```bash
kick db introspect --url postgres://... --out src/db/schema.ts
```

Per-adapter implementation:

- **pg** — `information_schema.tables/columns/key_column_usage` + `pg_catalog.pg_index` + `pg_constraint`.
- **sqlite** — `sqlite_schema` + `PRAGMA table_info` + `PRAGMA foreign_key_list` + `PRAGMA index_list`.
- **mysql** — `information_schema.tables/columns/statistics/key_column_usage`.

Each adapter exposes `introspect(): Promise<SchemaSnapshot>` returning the same `SchemaSnapshot` IR the diff engine uses. The CLI command renders the snapshot to TS source via the same emitter the migration system uses (one IR, one emitter, two consumers).

Use cases:

1. Bootstrap from existing DB. One-shot, then go forward with normal schema-first flow.
2. Drift recovery. Prod drifts (somebody ran a manual `ALTER`); introspect → diff against last snapshot → emit corrective migration.

Not in v6.0: views, materialized views, stored procs, triggers, custom enums beyond simple. Punted to v6.2.

## 11. Edge runtime support

Edge adapters (`-neon-http`, `-d1`, `-planetscale`) are v6.2. But core must not block them — three constraints baked in:

1. **No `node:`-only imports in core.** `node:fs` only inside the migration runner and introspection. Query path imports nothing from `node:*`. Edge bundle entry point: `@forinda/kickjs-db/edge` (omits the runner).
2. **Streaming may be unavailable.** Adapters declare `capabilities: { streaming, transactions, savepoints }`. Client throws clear errors when an op needs a missing capability.
3. **No top-level await on driver init.** Adapters expose async `connect()` for adopters that need it; core's `createDbClient` is sync and lazy.

D1 has notable wrinkles — no real transactions, batched-statements only — handled via `transactions: false`, throwing `TransactionsNotSupportedError`.

## 12. Versioning & compat

- Lockstep across all `db*` packages (matches kickjs convention).
- Kysely is a peer dep. Initial range `>=0.27.0 <1.0.0`. Narrows once we hit Kysely's own breaking changes.
- Schema snapshot format gets a `version: 1` field. Forward-compatible reader; v2 reader handles v1 files; v1 reader on v2 file errors with "regenerate or upgrade".

## 13. Roadmap

The original roadmap (M0–M7) was time-ordered around a v6.0.0 GA cut. M0–M5 all shipped on the 5.x line; the v6 framing is dropped — kickjs-db continues releasing patches + minors on 5.x indefinitely to keep adopters out of major-bump churn. The remaining items below are **ordered by adoption-blocker impact** rather than calendar.

### Shipped (M0–M5, all on 5.x)

| Milestone                          | Scope                                                                                                                                                                                                                                                                                                              | Released                                                                                                |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| M0 — Spike                         | diff-engine prototype, hand-authored PG migration                                                                                                                                                                                                                                                                  | `@forinda/kickjs-db@0.1.0`                                                                              |
| M1 — Walking skeleton              | full PG types + migration runner + `kick db generate`/`introspect`; `task-kickdb-api` example                                                                                                                                                                                                                      | `@forinda/kickjs-db@1.0.0`                                                                              |
| M2 — Type story + relational query | `db.query.X.findMany({ with })` + `customType<T>()` + `$extends({ model })` + lifecycle hooks + DevTools tab                                                                                                                                                                                                       | M2 release notes ([`m2-release.md`](./m2-release.md))                                                   |
| M3 — Multi-dialect                 | SQLite adapter; per-dialect SQL emitter; capability flags; `pgEnum` rename-recreate                                                                                                                                                                                                                                | M3 release notes ([`m3-release.md`](./m3-release.md))                                                   |
| M4 — Ecosystem fit                 | MySQL adapter (early); `defineTenantDbContributor`; `relationName` for multi-FK; composite-enum gate; Testcontainers enum-drop coverage                                                                                                                                                                            | M4 release notes ([`m4-release.md`](./m4-release.md))                                                   |
| M5 — Hardening                     | DEFAULT preservation through pgEnum rename-recreate; `AbortSignal` end-to-end + `RequestContext.signal`; `ReadonlyKysely` re-export; ALTER TYPE typed-IR; `safeNullComparison()` workaround for the broken Kysely upstream; **diff-engine fuzz (1000 seeds)**; **migration replay**; **SQL emission threat model** | M5 release notes ([`m5-release.md`](./m5-release.md)) + post-M5 hardening on `@forinda/kickjs-db@5.8.0` |

API reference docs for the whole db family (db + db-pg + db-sqlite + db-mysql) shipped at the same time as the M5 line. Three guide pages live in `docs/guide/` (schema types, relational queries, extensions).

#### Post-M5 — multi-dialect migration completion (5.x minors)

The migration engine is now symmetric across all three node dialects:

- **SQL emit** — `kick db generate` emits dialect-correct DDL for PostgreSQL, SQLite (incl. the safe **table rebuild** for column alters / FK changes SQLite's `ALTER TABLE` can't express), and MySQL (`MODIFY COLUMN`, `DROP FOREIGN KEY`, backtick idents). Dispatched by dialect in `generate()`.
- **Introspection** — `introspect()` implemented for all three (`information_schema` for PG/MySQL, `sqlite_master` + `PRAGMA` for SQLite), powering `kick db introspect`.
- **Drift detection** — works on all three. SQLite/MySQL introspection is lossy vs a code-first schema, so `checkDrift` canonicalises both sides (types through the emit mapper, defaults dropped, FK names structural) before diffing — meaningful drift, no false positives. Tunable via `db.driftCheck`.
- **CLI surface** — the `kick db` commands + db typegen ship from `@forinda/kickjs-db/cli` (`dbCliPlugin`) on the `@forinda/kickjs-cli-kit` contract, plus a standalone `kickjs-db` bin and `defineKickDbConfig` (mergeable config). `kick db migrate review <id>` flips the `meta.json` review gate (and migrates legacy in-file markers).

### Remaining work, in priority order

The order is the **adoption-blocker ranking** from the post-M5 gap audit. Each item is sized + sequenced so it can ship as a standalone minor on 5.x.

#### P1 — Edge runtime adapters

Adopters deploying to Vercel / Cloudflare / Deno Deploy can't use the bundled adapters today (the migration runner imports `node:fs`). Originally slotted for v6.2.

**Scope:**

- `@forinda/kickjs-db/edge` — edge-safe entry. Omits the migration runner + introspection + any `node:fs` / `node:path` import.
- `@forinda/kickjs-db-neon-http` — driver on `@neondatabase/serverless`.
- `@forinda/kickjs-db-d1` — Cloudflare D1 adapter (`transactions: false` capability flag; throws `TransactionsNotSupportedError` on `db.transaction()`).
- `@forinda/kickjs-db-planetscale` — PlanetScale serverless driver (optional follow-up).

**Exit:** boot `task-kickdb-api` against Neon HTTP from a Cloudflare Worker.

#### P2 — Schema GUI (DevTools tab expansion)

Adopters evaluating new ORMs reach for Studio / equivalent for the "look around the DB" moment. A first-party GUI in DevTools is the lowest-friction answer (no separate process to install).

**Scope:**

- `/db` tab in DevTools surfaces:
  - Schema browser (tables → columns + indexes + FKs).
  - Recent queries (already partially live via the lifecycle bus from M2.D).
  - **NEW:** row-level table browser with pagination (read-only by default; "edit" mode behind `NODE_ENV !== 'production'` + opt-in flag).
  - **NEW:** `EXPLAIN` / `EXECUTE` text-area for ad-hoc SQL (dev only).
  - **NEW:** pool stats (active/idle/waiting, max).

**Exit:** an adopter can navigate the schema + browse rows without leaving DevTools.

#### P3 — Seed framework

Every production app needs seeds. Today adopters write ad-hoc scripts.

**Scope:**

- `kick db seed make <name>` scaffolds `db/seeds/<name>.ts`.
- `kick db seed run [<name>]` executes one or all. Idempotency is the seed author's responsibility (use `onConflict.doNothing()`).
- `Seeder` interface: `export default async function seed(db: KickDbClient) { ... }`.
- No tracking table — re-running is safe by convention; the spec was deliberate in `architecture.md` §5.

**Exit:** `task-kickdb-api` ships a working `seeds/users.ts` + `seeds/projects.ts` referenced in the README quick-start.

#### P4 — `$extends({ result })` for computed columns

The `model` half shipped in M2; the `result` half (computed / virtual fields with `{ needs, compute }`) is still TODO. Closes a real gap that adopters notice immediately.

**Scope:**

- `$extends({ result: { users: { fullName: { needs: { firstName: true, lastName: true }, compute: (u) => `${u.firstName} ${u.lastName}` } } } })`.
- `needs` declares required columns — they're auto-included in `select` lists so the computed field never returns `undefined`.
- Extended client's select-type widens to include the computed key.
- Type-test suite locks the widening shape.

**Exit:** an adopter can recreate virtual fields without per-call wrapping.

#### P5 — Read-replica routing helper

Documented as a manual pattern today (register two adapters under `DB_PRIMARY` / `DB_REPLICA`). A first-party `routedDb({ reads, writes, stickyOnWrite })` helper would close the gap on the common pattern.

**Scope:**

- `routedDb({ writes: primary, reads: replica })` returns a `KickDbClient` that routes `selectFrom` to `reads` and everything else to `writes`.
- `stickyOnWrite: true` (default) — after the first write in a request, subsequent reads in the same request route to `writes` to avoid replication-lag staleness.
- Per-call override: `db.usingReplica('replica-2').selectFrom(...)`.

**Exit:** documented pattern in `docs/guide/db-multi-tenant.md`; example fixture in `task-kickdb-api`.

### Lower-priority follow-ups (P6+)

Order is rougher; pick by adopter signal.

- **Migration drift auto-repair.** Prisma can auto-emit a corrective migration from a drift diff. We surface `MigrationDriftError` but require operator intervention. Generating a `corrective_<timestamp>.sql` would close the loop.
- **Views + materialized views + stored procs in introspection.** Today `introspectPg` covers tables / columns / indexes / FKs only. Adding views requires DSL changes (a `view()` constructor) and is a non-trivial scope.
- **PG full-text search DSL.** `tsvector` column type exists; no query-side helpers for `to_tsquery`, `@@`, `ts_rank`. Adopters can drop to `sql\`...\``.
- **Vector-embedding query operators.** `vector(N)` column type exists in `@forinda/kickjs-db/pg`; `<->` (L2 distance), `<#>` (negative inner product), `<=>` (cosine distance) operators have no first-party DSL. Adopters use `sql\`...\`` for now.
- **`groupBy` aggregation sugar.** Prisma's `_sum` / `_avg` / `_count` style. Inherits Kysely's surface today.
- **Soft-delete plugin.** Achievable via `beforeQuery` + `$extends`; a first-party helper would beat boilerplate.
- **Migration squashing / consolidation.** No first-party path today; existing migrations stay forever.
- **Cache layer.** No first-party answer; adopters wire Redis or similar.
- **Real-time / live queries via PG logical replication.** Pulse-style. Substantial scope; probably belongs in a separate package (`@forinda/kickjs-db-live`).

### Risks called out elsewhere

The original §14 risk list still applies — type-inference complexity, diff-engine ambiguity at scale, drift-detection false positives, Kysely peer-dep churn, performance regressions in `with`-joins, adopter migration friction, CI runtime. The empirical mitigations shipped in M5 (fuzz, replay, threat model) cover three of those; the rest are ongoing.

### What's NOT happening (kept for clarity)

- **No v6.0.0 / v7.0 major cut.** Saved adopter preference — every roadmap item ships as patch or minor on 5.x. Items that would naturally warrant a major (removed export, changed default) get reshaped to fit minor semantics or deferred until a single coherent major is unavoidable.
- **Benchmarks vs raw `pg`.** Originally an M5 hardening item; deliberately deprioritised. Performance characterization for marketing rather than correctness; the SQL-builder layer (Kysely-shaped) has well-documented characteristics already, and the diff-engine fuzz proves correctness without bench numbers. May land as a P6 if an adopter raises a performance concern with a concrete repro.

## 14. Risks

Ordered by likelihood × impact.

1. **Type inference complexity exceeds estimate.** Drizzle's `SelectResult` distributive conditional took years. Mitigation: lean hard on Kysely; only original type-wiring is at `$inferSelect`, which is well-trodden.
2. **Diff engine ambiguity at scale.** Renames vs drop+add are ambiguous; type coercions where data semantics matter. Mitigation: review gate (never auto-apply down drafts); fuzz testing in M5; "give up and emit empty up/down with TODO" mode for unrepresentable changes.
3. **Migration drift detection false positives.** PG introspection sees auto-generated index names, sequence ownership chains the snapshot doesn't capture verbatim. Mitigation: snapshot stores _normalized_ schema; drift compares normalized form.
4. **Kysely breaking changes during M0–M5.** Mitigation: pin to a minor at start, peer-dep range from M5, contribute upstream when our needs converge.
5. **Performance regressions in `db.query` joins.** JSON aggregation cost varies per dialect. Mitigation: M5 benchmarks; documented per-dialect notes; escape hatch to layers 1/2 always available.
6. **Adopter migration to kickdb harder than predicted.** Mitigation: introspection lets adopters bootstrap a kickdb schema from an existing DB and incrementally swap repos.
7. **CI runtime balloons.** Three dialects × full integration = potentially 20+ minutes. Mitigation: dialect tests parallelized across jobs; PRs only run PG + SQLite; full matrix on `main` and tags.

## 15. Open questions

Deferred to implementation, flagged here.

1. **Snapshot format precise schema.** Section 5 sketches it; the exact key ordering, derived-vs-source attribute distinction, dialect-specific extensions need locking at M1.
2. **Generated migration tag format.** `20260427_153012_add_users` — slug user-supplied (knex pattern) or auto-derived from diff? Lean: user-supplied required; auto-derived suggestion in interactive mode.
3. **Introspect mapping for `serial`.** PG `serial` desugars to `integer + sequence + default nextval`. Should introspect output `serial()` (matching DSL intent) or desugared (matching DB reality)? Lean: `serial()`; `--literal` flag for desugared.
4. **Replica routing helper.** `routedDb({ reads: replica, writes: primary })`? Lean: document manual pattern in v6.0; helper if multiple adopters request in v6.1.
5. **Encryption-at-rest column type.** Recipe in `customType` examples or first-party `@forinda/kickjs-db-crypto` with key rotation? Lean: recipe in v6.0; package only on demand.

## 16. Reference reading

Three local repos studied during design:

- `/home/forinda/dev/open-source/knex` — migration runner, lock semantics, batch grouping, schema builder DSL, query builder events/`.modify()`/savepoints/streaming.
- `/home/forinda/dev/open-source/drizzle-orm` — branded-type schema DSL, distributive-conditional inference, `customType` mappers, HKT for driver result shapes, drizzle-kit's snapshot+journal model.
- `/home/forinda/dev/open-source/prisma` — `$extends` interception model, driver adapter contract, JSON-RPC generator protocol, drift detection, Rust engine architecture (rejected for scope).

External:

- [Kysely](https://kysely.dev) — typed query-builder core.
- [drizzle-kit migration model](https://orm.drizzle.team/docs/migrations) — what we extend with reversibility.
- [Knex migration CLI](https://knexjs.org/guide/migrations.html) — what we copy ergonomically.
