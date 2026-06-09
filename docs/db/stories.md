# `@forinda/kickjs-db` — Stories Backlog

> Spec: [`./architecture.md`](./architecture.md)
> Status: Draft v1
> Date: 2026-04-27

User-story breakdown of the milestones in §13 of the spec. Each story is sized to one PR (~1–5 days). Format:

```
[Mn-Sk] <Title>
As a <role>, I want <capability>, so that <outcome>.

Acceptance:
  - Verifiable check 1
  - Verifiable check 2
Touches: <files / packages / surfaces>
Depends on: [Mx-Sy, ...]
```

Roles used in this backlog:

- **Adopter** — application developer using `@forinda/kickjs-db` in a KickJS app.
- **Operator** — person running the migration CLI in CI / prod.
- **Maintainer** — KickJS core contributor working on this package.
- **Test author** — adopter writing tests against their schema.

Story IDs are stable. Add new ones at the end of their milestone section; never re-number.

---

## M0 — Spike (2 weeks)

Goal: prove the diff engine works. Single dialect (Postgres). No client. No Kysely yet. Hand-applied migrations.

### M0-S1 — Snapshot IR shape

As a **maintainer**, I want a typed `SchemaSnapshot` IR that captures table + column + constraint shape, so that the diff engine and SQL emitter both consume the same canonical form.

Acceptance:

- `SchemaSnapshot` exported from `packages/db/src/snapshot/types.ts`.
- Covers: tables, columns (name, type, nullable, default, primary), foreign keys (cols + onDelete + onUpdate), indexes (cols + unique), check constraints, sequences (PG).
- Snapshot is JSON-serializable (no functions, no symbols, no dates — ISO strings).
- Unit test round-trips a hand-built snapshot through `JSON.stringify` + `JSON.parse` with structural equality.

Touches: `packages/db/src/snapshot/`
Depends on: —

### M0-S2 — Schema DSL → snapshot extraction (PG, 6 column types)

As a **maintainer**, I want `extractSnapshot(schema)` to walk the exported `table()` declarations and emit a `SchemaSnapshot`, so that the diff engine has the _target_ state.

Acceptance:

- `extractSnapshot(schema: Record<string, Table | Relations>)` returns `SchemaSnapshot`.
- Handles 6 column types: `serial`, `integer`, `varchar(n)`, `text`, `boolean`, `timestamp`.
- Handles `.notNull()`, `.default(...)`, `.primaryKey()`, `.unique()`, `.references()`.
- Handles single-column `index()` declared in the third arg.
- Relations are NOT in the snapshot (relations are query-time sugar, not DDL).
- Test: a 2-table schema (users, posts with FK) extracts to the expected snapshot.

Touches: `packages/db/src/dsl/`, `packages/db/src/snapshot/extract.ts`
Depends on: M0-S1

### M0-S3 — Diff engine (snapshot → change set IR)

As a **maintainer**, I want `diff(prev, target)` to produce an ordered `ChangeSet` of `CreateTable | DropTable | AddColumn | DropColumn | AlterColumn | AddIndex | DropIndex | AddFK | DropFK | AddCheck | DropCheck | RenameColumn | RenameTable`, so that the emitter can compile to SQL.

Acceptance:

- `diff()` is a pure function.
- Order respects dependency: drop FK before drop column it references; create table before adding FK that references it.
- Rename detection uses a heuristic (same type + similar name + same constraints). Ambiguous cases default to drop+add and flag in the result metadata.
- Each change carries enough state for both forward and reverse SQL emission (e.g., `DropColumn` carries the full prior column descriptor).
- Test: 10+ fixture pairs (no-op, add table, drop table, add col, drop col, alter type, add FK, add index, rename col, complex multi-change) verify the emitted change set.

Touches: `packages/db/src/diff/`
Depends on: M0-S1

### M0-S4 — PG SQL emitter (forward DDL only)

As a **maintainer**, I want `emitPg(changes)` to produce valid Postgres `up.sql`, so that we can hand-apply it and verify against a real DB.

Acceptance:

- Covers all change types from M0-S3.
- Identifiers double-quoted; literals safely formatted (no SQL injection in defaults).
- `serial` desugars correctly (sequence + integer + nextval default).
- Output is a single string of newline-separated statements ending with `;`.
- Test: snapshot-tested against fixtures from M0-S3.

Touches: `packages/db/src/emit/pg.ts`
Depends on: M0-S3

### M0-S5 — Hand-apply verification

As a **maintainer**, I want a Testcontainer-backed integration test that applies an emitted `up.sql` against real Postgres and introspects the result, so that I know the emitter produces what we think it does.

Acceptance:

- Vitest integration test spins up `@testcontainers/postgresql`.
- Applies emitted SQL via raw `pg`.
- Queries `information_schema` and asserts the resulting DB shape matches the target snapshot (modulo derived attributes).
- Runs as part of `pnpm test` for the `packages/db` workspace.

Touches: `packages/db/__tests__/integration/spike.test.ts`
Depends on: M0-S4

### M0-S6 — `kick db generate` minimal CLI

As an **operator**, I want a one-command path from schema-edit to `up.sql`, so that I can validate the spike end-to-end.

Acceptance:

- `kick db generate <name>` reads `kick.config.ts` for `db.schemaPath`, loads the schema, runs extract → diff (vs latest snapshot or empty), emits `up.sql` + `snapshot.json` + `meta.json` to `db/migrations/<timestamp>_<name>/`.
- No `down.sql` yet (M1).
- No journal file yet.
- Exit 0 on success; non-zero with diagnostic on failure.

Touches: `packages/cli/src/commands/db.ts` (new), `packages/db/src/cli/`
Depends on: M0-S2, M0-S4

**M0 exit gate:** start from empty DB, write a 2-table TS schema, run `kick db generate init`, hand-apply the emitted `up.sql`, introspect the live DB and confirm parity. Spike done.

---

## M1 — Walking skeleton (4 weeks)

Goal: end-to-end happy path on PG. One example app boots through `kickDbAdapter` and serves typed queries via Kysely.

### M1-S1 — Full PG column type set

As an **adopter**, I want every PG-supported column type the spec lists in §4, so that I'm not blocked by a missing type.

Acceptance:

- All cross-dialect types implemented: `bigSerial`, `bigint`, `smallint`, `decimal`, `numeric`, `real`, `doublePrecision`, `char`, `timestamptz`, `date`, `time`, `interval`, `uuid`, `json`, `jsonb`, `bytea`.
- Subpath `@forinda/kickjs-db/pg` exports `tsvector`, `vector(n)`, `citext`, `money`, `inet`, `cidr`, `xml`.
- `.array()` modifier works on supported types.
- Each type round-trips through extract → emit → apply → introspect with no drift.

Touches: `packages/db/src/dsl/columns/`, `packages/db/pg/`
Depends on: M0-S5

### M1-S2 — Down emitter + ambiguity markers

As an **operator**, I want every generated migration to come with a reversed `down.sql` and a `-- REVIEWED: false` header, so that I can reverse safely and the runner can refuse unreviewed work in non-dev.

Acceptance:

- `emitPgDown(changes, prevSnapshot)` produces reverse SQL.
- Top of file: `-- REVIEWED: false`. If any change is ambiguous (drop col, drop table, narrowing type, NOT NULL without default), additionally `-- DRAFT: review before applying` on line 2.
- `up.sql` also gets `-- REVIEWED: false` header.
- Same header in `meta.json: { reviewed: false }`.
- Test: ambiguous-change fixture produces DRAFT marker; clean-change fixture does not.

Touches: `packages/db/src/emit/pg.ts`
Depends on: M0-S4

### M1-S3 — Journal file (`_journal.json`)

As an **operator**, I want every generation to update an ordered `_journal.json` with hash + tag, so that the runner has a deterministic apply order.

Acceptance:

- `_journal.json` schema: `{ version: 1, dialect, entries: [{ id, tag, hash, createdAt }] }`.
- Hash = `sha256(up.sql + down.sql + snapshot.json)`.
- New entries appended in order; `kick db generate` is idempotent (re-running on no schema change exits 0 with "no pending changes").

Touches: `packages/db/src/migrate/journal.ts`
Depends on: M1-S2

### M1-S4 — Migration tracking + lock tables

As an **operator**, I want `kick_migrations` and `kick_migrations_lock` to be created on first run, so that the runner has somewhere to record state.

Acceptance:

- Schema for `kick_migrations` (id, name, hash, batch, applied_at, direction).
- Schema for `kick_migrations_lock` (id PK, locked_at, locked_by).
- Bootstrap is idempotent — `CREATE TABLE IF NOT EXISTS`.
- Lock acquisition: PG `INSERT INTO kick_migrations_lock (id) VALUES (1) ON CONFLICT DO NOTHING RETURNING id` — empty result = collision.
- Test: two parallel runners; second fails with `MigrationLockError`; first completes.

Touches: `packages/db/src/migrate/runner.ts`, `packages/db/src/migrate/lock.ts`
Depends on: M1-S3

### M1-S5 — Runner: `migrate latest` / `up` / `down` / `rollback` / `status`

As an **operator**, I want all five core subcommands working on PG, so that I can drive the full lifecycle.

Acceptance:

- `kick db migrate latest` — applies all pending; new batch number.
- `kick db migrate up` — applies one pending; uses the same next batch.
- `kick db migrate down` — reverses the most recent applied entry.
- `kick db migrate rollback` — reverses the entire last batch in one transaction (PG).
- `kick db migrate status` — table of applied + pending with batch numbers, hashes, marker state.
- Each migration runs in its own transaction (configurable per migration via `meta.json.transaction: false`).
- Hash mismatch on apply → `MigrationHashError` with diff hint.
- Unreviewed migration applied in non-dev → `UnreviewedMigrationError`.

Touches: `packages/db/src/migrate/runner.ts`, `packages/cli/src/commands/db.ts`
Depends on: M1-S4

### M1-S6 — Drift detection on `migrate latest`

As an **operator**, I want `migrate latest` to introspect the live DB and compare against the last-applied snapshot before doing anything, so that drift surfaces as a clear error and not as a silent corruption.

Acceptance:

- Drift check runs before pending migrations are applied.
- Mismatch → `MigrationDriftError` with structured diff (added/removed/changed tables and columns).
- Behavior `error|warn|ignore` configurable in `kick.config.ts: db.driftCheck`. Default `error`.
- Snapshot comparison uses normalized form (alphabetized columns, derived constraints flagged) so PG implementation details don't false-positive.

Touches: `packages/db/src/migrate/drift.ts`, `packages/db/src/snapshot/normalize.ts`
Depends on: M1-S5

### M1-S7 — `kickDbAdapter()` — adapter wiring

As an **adopter**, I want `kickDbAdapter()` to plug into `bootstrap()` like every other KickJS adapter, so that the client lands in DI without me wiring it manually.

Acceptance:

- `kickDbAdapter({ schema, adapter, migrationsOnBoot, events, log })` is a `defineAdapter()` factory (per memory: all adapter snippets use `defineAdapter`/`definePlugin`).
- `beforeStart` registers a `KickDbClient` against `DB_PRIMARY` (or `opts.token`).
- `migrationsOnBoot` honored: `'fail-if-pending'` (default) errors on pending; `'apply'` runs `migrate latest`; `'ignore'` proceeds.
- `shutdown` calls `db.destroy()`.
- Cooperative shutdown — wrapped in `Promise.allSettled` group; one slow flush can't block siblings.

Touches: `packages/db/src/adapter.ts`
Depends on: M1-S5

### M1-S8 — `KickDbClient` over Kysely (PG)

As an **adopter**, I want `db.selectFrom('users').selectAll().execute()` to return typed rows, so that I get day-one DX from the spec's Layer 1.

Acceptance:

- `createDbClient({ schema, adapter })` returns a `KickDbClient` wrapping a Kysely `Kysely<DbSchema>`.
- `DbSchema` is inferred from the schema export (`Record<TableName, RowType>`).
- `selectFrom`, `selectAll`, `where`, `limit`, `orderBy`, `executeTakeFirst`, `execute` all work on PG.
- `insertInto`, `values`, `returningAll`, `execute` work.
- `updateTable`, `set`, `where`, `execute` work.
- `deleteFrom`, `where`, `execute` work.

Touches: `packages/db/src/client/`, `packages/db-pg/src/`
Depends on: M1-S1, M1-S7

### M1-S9 — DI tokens

As an **adopter**, I want `DB_PRIMARY` and `DB_REPLICA` exported as typed tokens, so that I can `@Inject(DB_PRIMARY) private db!: KickDbClient`.

Acceptance:

- `DB_PRIMARY` and `DB_REPLICA` exported from `@forinda/kickjs-db`.
- Both are `createToken<KickDbClient>('app/db/primary' | 'app/db/replica')`.
- `kickDbAdapter({ token: DB_REPLICA })` registers under that token.
- `DB_CLIENT = DB_PRIMARY` re-export for the "default" name.
- Test: two adapters wired (primary + replica) — both injectable; injection scopes independent.

Touches: `packages/db/src/tokens.ts`, `packages/db/src/adapter.ts`
Depends on: M1-S7

### M1-S10 — `task-kickdb-api` example app

As a **maintainer**, I want a full task-management example to prove M1 works in a real KickJS app, so that the milestone exit gate is meaningful.

Acceptance:

- `examples/task-kickdb-api/` exists, scaffolded via the CLI (per CLAUDE.md mandatory rule).
- Standard task-management routes and DTOs.
- Schema in `src/db/schema.ts`. Migrations committed under `db/migrations/`.
- `pnpm dev` boots; all REST endpoints return correct responses.
- README links to the architecture spec.

Touches: `examples/task-kickdb-api/`, `scripts/release.js` (EXAMPLES array), `docs/.vitepress/config.mts` (sidebar)
Depends on: M1-S8, M1-S9

**M1 exit gate:** the kickdb example runs a full task-management feature set, with reversible migrations and drift detection.

---

## M2 — Type story + relational query (3 weeks)

Goal: best-in-class type DX. Inference at every API surface; `db.query` joins; custom types; `$extends`; hooks.

### M2-S1 — `$inferSelect` / `$inferInsert` / `$inferUpdate`

As an **adopter**, I want `typeof users.$inferSelect` to give me a row type with correct nullability and defaultedness, so that my service code is end-to-end typed.

Acceptance:

- `$inferSelect` — every column non-optional; nullable columns are `T | null`.
- `$inferInsert` — defaulted columns optional; NOT NULL without default required.
- `$inferUpdate` — every column optional, all values `T | undefined`.
- `expectTypeOf` test suite in `packages/db/__tests__/unit/type-inference.test.ts` exercises 8+ representative tables.

Touches: `packages/db/src/dsl/types.ts`
Depends on: M1-S1

### M2-S2 — Schema-bound aliases (Layer 2)

As an **adopter**, I want `db.select().from(users).where(eq(users.email, 'x'))` to be type-safe, so that I don't have to remember string keys.

Acceptance:

- `db.select()`, `db.insert(table)`, `db.update(table)`, `db.delete(table)` all accept the schema-export Table values.
- Operator helpers exported: `eq`, `ne`, `gt`, `lt`, `gte`, `lte`, `like`, `ilike`, `inArray`, `notInArray`, `isNull`, `isNotNull`, `between`, `and`, `or`, `not`, `exists`, `notExists`.
- All operators infer column types and reject mismatched values at compile time.
- Layers 1 and 2 interoperate (same Kysely engine; same execution model).

Touches: `packages/db/src/client/aliases.ts`, `packages/db/src/expr/`
Depends on: M1-S8, M2-S1

### M2-S3 — Relations API (`relations()` helper)

As an **adopter**, I want `relations(users, ({ many }) => ({ posts: many(posts) }))` to register relationships my queries can join through, so that I don't write join SQL by hand for the common case.

Acceptance:

- `relations()` helper accepts table + builder fn returning a record of relation declarations.
- `one(target, { fields, references })` and `many(target, { fields?, references? })` both work.
- Relations live in a separate registry keyed by table; not on the table object itself.
- Compile error if `with: { wrongName: ... }` references an undeclared relation.

Touches: `packages/db/src/dsl/relations.ts`
Depends on: M2-S1

### M2-S4 — `db.query.X.findMany / findFirst / findUnique` (Layer 3)

As an **adopter**, I want `db.query.users.findMany({ with: { posts: true } })` to return one SQL query with `posts` aggregated, so that I avoid N+1 by default.

Acceptance:

- `findMany({ where, with, orderBy, limit, offset })` works.
- `with: { posts: true }` aggregates via PG `json_agg`.
- `with: { posts: { where, limit, orderBy } }` honored.
- Result type includes `posts: Post[]` when `with.posts` is set.
- `findFirst` returns `T | undefined`; `findUnique` requires a unique key in `where`.
- Single round-trip per call; verified via lifecycle hook spy in tests.

Touches: `packages/db/src/client/query/`
Depends on: M2-S2, M2-S3

### M2-S5 — `customType<T>()` mapper

As an **adopter**, I want `customType<EncryptedString>({ dataType, toDriver, fromDriver })` to define a column whose values transform on the way in and out, so that I can ship encrypted/citext/JSON-with-shape columns cleanly.

Acceptance:

- `customType` exported from core.
- Forward emit uses `dataType()` for the SQL type.
- Insert/update path runs `toDriver`; select path runs `fromDriver`.
- Type parameter `T` flows through `$inferSelect/Insert/Update`.
- Test: define an `encryptedText` custom type; round-trip a value through insert + select; assert `toDriver` and `fromDriver` are called.

Touches: `packages/db/src/dsl/custom.ts`
Depends on: M2-S1

### M2-S6 — `$extends({ model, result })`

As an **adopter**, I want to add custom methods and computed result fields to a model, so that I don't subclass the client.

Acceptance:

- `db.$extends({ model: { users: { fooBar() { ... } } } })` returns a new client.
- Extended client has `dbX.users.fooBar` callable; `this` bound to a client scoped to the `users` model.
- `result: { users: { fullName: { needs, compute } } }` adds `fullName` to the inferred select-type for that table; `needs` columns auto-included; `compute(row)` runs post-fetch.
- `query` extension intentionally NOT supported (per spec §6 — `beforeQuery` hook covers it).
- Test: extended methods callable; `result` extensions appear on `findMany` rows.

Touches: `packages/db/src/client/extend.ts`
Depends on: M2-S2

### M2-S7 — Lifecycle hooks (`db.on(...)`)

As an **adopter**, I want `db.on('query', ...)` and `db.on('queryError', ...)` to fire for every executed statement, so that I can route to logging/tracing without a wrapper layer.

Acceptance:

- Events: `beforeQuery`, `query`, `queryError`, `transactionStart`, `transactionCommit`, `transactionRollback`, `slowQuery`.
- Listener signatures match the spec §6.
- Async listeners awaited in registration order.
- Listener errors caught + logged; query not aborted (except `beforeQuery` errors, which abort).
- `beforeQuery` may mutate `event.sql` / `event.parameters`.
- `events: false` makes `db.on()` a no-op (zero overhead path).

Touches: `packages/db/src/client/events.ts`
Depends on: M1-S8

### M2-S8 — Slow query threshold

As an **adopter**, I want queries slower than `slowQueryThresholdMs` to emit a warn log and a `slowQuery` event, so that performance regressions surface in CI.

Acceptance:

- `kickDbAdapter({ slowQueryThresholdMs: 50 })` honored. Default `200`. `null` disables.
- Threshold applies to total query time including param binding.
- `slowQuery` event includes `{ sql, parameters, ms, threshold }`.

Touches: `packages/db/src/client/events.ts`
Depends on: M2-S7

### M2-S9 — DevTools tab — initial

As an **adopter**, I want a `/_debug/db` tab that shows pool metrics + applied migrations + schema, so that I can debug locally without external tools.

Acceptance:

- Tab registered via `defineDevtoolsTab` from `@forinda/kickjs-devtools-kit` (per memory: framework metadata helpers, never raw `Reflect`).
- Sections: Pool, Schema, Migrations.
- Recent queries section if `events: true` AND non-prod.
- All write controls disabled in production (UI hidden + endpoint refuses on `NODE_ENV === 'production'`).

Touches: `packages/db/src/devtools/`
Depends on: M2-S7, M1-S5

**M2 exit gate:** full type DX surface — typed schema, typed queries (3 layers), relations, custom types, extensions, hooks, slow query alerting.

---

## M3 — SQLite + multi-dialect (3 weeks)

Goal: full PG + SQLite parity. Per-dialect emitter. Capability flags. Edge-readiness deferred to M6.

### M3-S1 — `db-sqlite` adapter

As an **adopter**, I want `sqliteAdapter(new Database(':memory:'))` to provide a fully-functional client, so that my unit tests run without a DB server.

Acceptance:

- `packages/db-sqlite/` published. Peer dep `better-sqlite3`. ~50 LOC factory.
- Wraps Kysely's `SqliteDialect` with the `KickDbAdapter` contract.
- Pool stub (better-sqlite3 is single-threaded) but reports correct `capabilities: { streaming: false, transactions: true, savepoints: true }`.
- Drift detection works via SQLite introspection (`PRAGMA table_info` + `PRAGMA foreign_key_list` + `PRAGMA index_list`).

Touches: `packages/db-sqlite/`
Depends on: M2-S9

### M3-S2 — SQLite SQL emitter

As a **maintainer**, I want a SQLite-flavored SQL emitter, so that the same change set IR produces valid SQL for SQLite.

Acceptance:

- `emitSqlite(changes)` for both up and down.
- Handles SQLite quirks: no real `ALTER TYPE` (rebuild table dance), `INTEGER PRIMARY KEY AUTOINCREMENT`, no native `boolean` (INTEGER 0/1).
- `serial` desugars to `INTEGER PRIMARY KEY AUTOINCREMENT`.
- `boolean` stored as `INTEGER`; round-trips at the client layer.
- All M0-S3 fixtures emit valid SQLite SQL.

Touches: `packages/db/src/emit/sqlite.ts`
Depends on: M0-S3

### M3-S3 — Capability flags

As an **adopter**, I want clear `StreamingNotSupportedError` / `TransactionsNotSupportedError` / `SavepointsNotSupportedError` instead of silent fallbacks, so that I don't get bitten by adapter limitations in prod.

Acceptance:

- `KickDbAdapter` interface includes `capabilities: { streaming, transactions, savepoints }`.
- Client checks the flag before invoking the corresponding op.
- Errors include the adapter name and the unsupported op.
- Test: SQLite adapter throws `StreamingNotSupportedError` on `.stream()` (better-sqlite3 has no async streaming).

Touches: `packages/db/src/adapter.ts`, `packages/db/src/client/`
Depends on: M3-S1

### M3-S4 — Dialect-parameterized integration suite

As a **maintainer**, I want every integration test to run against both PG and SQLite, so that we don't ship dialect regressions.

Acceptance:

- `describe.each([{ name: 'pg', setup }, { name: 'sqlite', setup }])` wraps every integration file.
- PG runs via `@testcontainers/postgresql`; SQLite in-memory.
- CI pipeline runs PG + SQLite on PRs; full matrix on `main` and tags.
- Test names include dialect for failure clarity.

Touches: `packages/db/__tests__/integration/`, `.github/workflows/ci.yml`
Depends on: M3-S2, M3-S3

### M3-S5 — Streaming (PG)

As an **adopter**, I want `for await (const row of db.selectFrom(...).stream())` to use a real cursor, so that I can iterate huge tables without OOM.

Acceptance:

- PG adapter uses `pg-cursor` or equivalent server-side cursor.
- `.stream(opts)` accepts `chunkSize: number` (default 100); underlying cursor batched accordingly.
- Backpressure honored — adapter pauses cursor when consumer is slow.
- Error mid-stream cleans up cursor and connection.

Touches: `packages/db-pg/src/streaming.ts`
Depends on: M2-S2

### M3-S6 — Savepoints

As an **adopter**, I want `tx.savepoint(async (sp) => { ... })` for nested rollback boundaries, so that complex business logic can isolate failure points.

Acceptance:

- Savepoint API on the transaction handle.
- Auto-generated SQL-safe savepoint names (sp_1, sp_2 ...); user can pass `name`.
- Throw inside callback → savepoint rollback only, outer transaction continues.
- Works on PG, SQLite, MySQL.
- Test: nested transaction with one savepoint that rolls back; outer commit succeeds; verified row state.

Touches: `packages/db/src/client/transaction.ts`
Depends on: M3-S3

### M3-S7 — `.modify(fn, ...args)`

As an **adopter**, I want a knex-style `.modify()` method on the query builder, so that I can DRY conditional filter composition.

Acceptance:

- `qb.modify(fn, ...args)` calls `fn(qb, ...args)` and returns the result.
- Type-checked: the modifier function's first arg must accept the current builder's type; return must be a builder of the same shape.
- Works on Layer 1 and Layer 2 alike.

Touches: `packages/db/src/client/builder.ts`
Depends on: M2-S2

**M3 exit gate:** full integration suite green on PG + SQLite. Streaming, savepoints, `.modify()` available and tested.

---

## M4 — KickJS ecosystem fit (3 weeks)

Goal: zero-friction `kick new --repo kickdb`. Multi-tenant solved. DevTools polished. Docs complete.

### M4-S1 — `kick g module --repo kickdb` template

As an **adopter**, I want `kick g module users --repo kickdb` to scaffold the standard DDD module shape with a kickdb repository, so that I get a one-command module scaffolding experience.

Acceptance:

- New repo template `kickdb` registered in `packages/cli/src/generators/templates/kickdb/`.
- Generates: `users.schema.ts`, `users.repository.ts` (`@Service()` + `@Inject(DB_PRIMARY)`), `users.service.ts`, `users.controller.ts`, `users.dto.ts`, `users.module.ts`.
- `users.schema.ts` is automatically re-exported from `src/db/schema.ts` aggregate; `kick rm module users` removes both.
- `kick new --template ddd --repo kickdb` works end-to-end.
- `kick g scaffold post title:string body:text:optional --repo kickdb` also generates kickdb shape.

Touches: `packages/cli/src/generators/templates/kickdb/`, `packages/cli/src/commands/generate.ts`, `packages/cli/src/commands/init.ts`
Depends on: M3-S7

### M4-S2 — `defineTenantDbContributor` helper

As an **adopter**, I want a one-liner Context Contributor that scopes `db` per tenant, so that I don't write the multi-tenant plumbing myself (and don't reach for the deprecated `kickjs-multi-tenant`).

Acceptance:

- `defineTenantDbContributor({ key, base, resolveTenant, buildClient })` exported from core.
- Returns a `ContextContributor` keyed on `'db'` (or `opts.key`) — typed against `keyof ContextMeta`.
- `buildClient` is called once per tenant per request; supports `withSchema(...)` for PG search_path.
- Adopter app demo in `examples/multi-tenant-kickdb-api/` (CLI-scaffolded).
- Memory rules honored: writes flow via `ctx.set` or contributor return; never `setRequestValue`. User code reads via `ctx.get(...)` or `getRequestValue(...)`; no raw `requestStore.getStore().values`.

Touches: `packages/db/src/contributors/tenant.ts`, `examples/multi-tenant-kickdb-api/`
Depends on: M4-S1

### M4-S3 — `createTestDb()` helper

As a **test author**, I want `createTestDb({ schema, dialect: 'sqlite' })` for unit tests and `createTestDb({ schema, adapter, migrate: 'transactional' })` for integration tests, so that I don't write fixture boilerplate per test file.

Acceptance:

- `createTestDb` exported from `@forinda/kickjs-testing`.
- `dialect: 'sqlite'` shortcut spins in-memory better-sqlite3.
- `migrate: 'fresh'` runs `migrate latest` from empty.
- `migrate: 'transactional'` opens a tx in `beforeEach`, rolls back in `afterEach` (PG only; SQLite + MySQL fall back to `'fresh'`).
- Cleanup helper returned: `{ db, cleanup }`.
- Existing `createTestApp` / `createTestModule` accept `adapters: [kickDbAdapter(...)]` (already supported; doc update only).

Touches: `packages/testing/src/db.ts`
Depends on: M3-S6

### M4-S4 — DevTools tab — full

As an **adopter**, I want the DevTools `/_debug/db` tab to support live query (EXPLAIN/EXECUTE) and the migration apply button in dev, so that I can iterate quickly without dropping to a SQL client.

Acceptance:

- Live query input + EXPLAIN button + EXECUTE button (dev only).
- Migration "Apply pending" + "Rollback batch" buttons (dev only).
- Recent queries searchable; click → see params + duration + stack snippet (dev only).
- All write controls return 403 in prod regardless of UI state.

Touches: `packages/db/src/devtools/`
Depends on: M2-S9

### M4-S5 — Lifecycle metrics adapter (BYO meter)

As an **adopter**, I want `kickDbAdapter({ meter })` to publish OTel metrics, so that my BYO observability stack ingests pool + query stats.

Acceptance:

- `kickjs_db_query_duration_ms` (histogram, attrs `dialect`, `op`, `table` if derivable).
- `kickjs_db_pool_active` / `_idle` / `_waiting` (gauges, polled 5s).
- `kickjs_db_query_errors_total` (counter, attrs `code`).
- `kickjs_db_migrations_applied_total` (counter).
- Verified against an in-memory OTel `MeterProvider` test collector.

Touches: `packages/db/src/observability/metrics.ts`
Depends on: M2-S7

### M4-S6 — OTel tracing adapter (BYO tracer)

As an **adopter**, I want `kickDbAdapter({ tracer })` to open spans for every query / transaction / migration, so that my BYO OTel SDK exports them.

Acceptance:

- Spans: `db.query`, `db.transaction`, `db.migration`.
- Standard semconv attrs (`db.system`, `db.statement` sanitized, `db.operation`).
- KickJS-specific attrs (`kickjs.dialect`, `kickjs.adapter`).
- Tracer optional (null-safe).
- Verified via in-memory `SpanProcessor`.

Touches: `packages/db/src/observability/tracing.ts`
Depends on: M2-S7

### M4-S7 — Documentation

As an **adopter**, I want guide pages under `docs/guide/` covering every public surface, so that I learn the package without reading the source.

Acceptance:

- `docs/guide/db-getting-started.md` — install, schema, first migration, first query.
- `docs/guide/db-schema.md` — DSL reference.
- `docs/guide/db-migrations.md` — generation, review, runner subcommands, drift, ambiguity policy.
- `docs/guide/db-queries.md` — Layers 1/2/3 with examples.
- `docs/guide/db-transactions.md` — transactions + savepoints.
- `docs/guide/db-multi-tenant.md` — `defineTenantDbContributor` recipe (replaces deprecated multi-tenant package).
- `docs/guide/db-testing.md` — `createTestDb`.
- `docs/guide/db-extensions.md` — `customType` + `$extends`.
- `docs/guide/db-introspection.md` — `kick db introspect`.
- `docs/guide/db-errors.md` — error hierarchy + handling patterns.
- `docs/guide/db-observability.md` — events + tracing + metrics.
- `docs/api/db.md` — generated reference.
- Sidebar updated in `docs/.vitepress/config.mts`.
- All internal links relative (per kickjs convention).

Touches: `docs/guide/db-*.md`, `docs/api/db.md`, `docs/.vitepress/config.mts`
Depends on: M4-S6

**M4 exit gate:** `kick new my-api --repo kickdb` produces a fully-running app with multi-tenant, DevTools, OTel, tests, docs.

---

## M5 — Hardening + v6.0.0 release (2 weeks)

Goal: ship. Production-ready as the new default.

### M5-S1 — Microbenchmarks

As a **maintainer**, I want benchmarks for read/write/transaction/`with`-join scenarios against raw `pg`, so that we can claim performance bounds publicly.

Acceptance:

- `benchmarks/db/` exists with one bench file per scenario.
- Targets:
  - simple `SELECT *` — within 10% of raw `pg`.
  - simple `INSERT` returning — within 10%.
  - 100-row transaction — within 15%.
  - `findMany({ with })` 1-to-many — within 25% of raw `pg` doing two queries.
- Results checked into `benchmark-results.json` and rendered in `docs/guide/db-benchmarks.md`.

Touches: `benchmarks/db/`, `docs/guide/db-benchmarks.md`, `benchmark-results.json`
Depends on: M4-S6

### M5-S2 — Diff engine fuzzing

As a **maintainer**, I want a 1000-fixture fuzz suite over the diff engine, so that we catch ambiguous-change misclassifications before users hit them.

Acceptance:

- Generator produces random snapshot pairs across tables, columns, types, FKs, indexes, checks.
- Each pair: `diff(prev, next)` → emit up + down → apply up → verify state → apply down → verify back to prev.
- Failures recorded with the failing fixture for regression.
- Runs nightly on CI; not on PRs (too slow).

Touches: `packages/db/__tests__/fuzz/`, `.github/workflows/ci.yml`
Depends on: M5-S1

### M5-S3 — Migration replay test

As a **maintainer**, I want a test that replays every committed migration in the example apps to verify the runner is deterministic, so that real-world migration histories are guaranteed reversible.

Acceptance:

- Test: for each example with kickdb, run `migrate latest` → introspect → run `migrate rollback --all` → introspect (verify empty) → `migrate latest` again → introspect (verify identical to first).

Touches: `packages/db/__tests__/integration/replay.test.ts`
Depends on: M5-S2

### M5-S4 — SQL injection threat model

As a **maintainer**, I want a documented threat model for the SQL emitter and query path, so that we know which inputs are trusted and which aren't.

Acceptance:

- `docs/db/security.md` (this folder) lists every input source: schema literals (trusted, dev-time), migration SQL (trusted, reviewed), query parameters (untrusted, always bound), `.modify` callbacks (trusted, dev-authored), `customType.toDriver` outputs (trusted return; raw values bound).
- All hot paths verified to use parameter binding (no string concat).
- Identifier-quoting checked against test fixtures with adversarial table/column names.

Touches: `docs/db/security.md`
Depends on: M5-S3

### M5-S6 — v6.0.0 release

As a **maintainer**, I want a clean v6.0.0 tag with all packages bumped lockstep, so that the public release lands.

Acceptance:

- `pnpm release:major` runs cleanly. All `db*` packages at 6.0.0.
- `RELEASE_NOTES_v6.0.0.md` written. Highlights: kickdb ships, BYO recipes carry forward.
- npm publish via CI (release.yml).
- GitHub release attached.

Touches: `RELEASE_NOTES_v6.0.0.md`, `scripts/release.js`, `packages/*/package.json`
Depends on: M5-S4

**M5 exit gate:** v6.0.0 published.

---

## M6 — v6.1 (~4–6 weeks after v6.0)

Goal: MySQL + edge runtimes.

### M6-S1 — `db-mysql` adapter

As an **adopter**, I want a `mysql2`-backed adapter, so that MySQL-only apps can adopt kickdb.

Acceptance:

- `packages/db-mysql/` published. Peer dep `mysql2`.
- `emitMysql(changes)` implemented for both directions.
- MySQL quirks: no transactional DDL on most engines (lock acquired around per-migration boundary, no per-migration tx); no `RETURNING`; identifier backticks.
- `capabilities: { streaming: true, transactions: true, savepoints: true }`.
- Full integration suite green.
- Testcontainers job added to CI.

Touches: `packages/db-mysql/`, `packages/db/src/emit/mysql.ts`, `.github/workflows/ci.yml`
Depends on: M5-S6

### M6-S2 — Edge entry point (`@forinda/kickjs-db/edge`)

As an **adopter**, I want a tree-shakeable edge entry that omits the migration runner and `node:fs` paths, so that I can import kickdb in a Cloudflare Worker / Vercel Edge function.

Acceptance:

- Subpath export `./edge` in `packages/db/package.json`.
- Edge bundle excludes: migration runner, introspection, `node:fs`, `node:path`, `node:crypto` (replaced with WebCrypto).
- Bundlephobia size budget: < 30KB minified+gzipped for the edge entry.
- Smoke test: build a Worker that imports `@forinda/kickjs-db/edge` and runs a `selectFrom` against an HTTP-driver mock.

Touches: `packages/db/edge/`, `packages/db/package.json`
Depends on: M6-S1

### M6-S3 — `db-neon-http` adapter

As an **adopter**, I want a Neon HTTP-driver adapter, so that I can run kickdb in serverless/edge with Neon Postgres.

Acceptance:

- Wraps `@neondatabase/serverless` HTTP client.
- `capabilities: { streaming: false, transactions: false, savepoints: false }` (Neon HTTP is single-shot per request).
- `TransactionsNotSupportedError` thrown on `db.transaction()`.
- Documented adopter pattern: use Neon WS driver where transactions are needed.

Touches: `packages/db-neon-http/`
Depends on: M6-S2

### M6-S4 — `db-d1` adapter

As an **adopter**, I want a Cloudflare D1 adapter, so that I can ship kickdb in Workers.

Acceptance:

- Wraps the D1 binding interface.
- `capabilities: { streaming: false, transactions: false, savepoints: false }` (D1 supports `batch` but not real transactions).
- `db.batch([...])` exposed as a D1-specific feature on the client when adapter is D1.
- Documented limitations.

Touches: `packages/db-d1/`
Depends on: M6-S3

**M6 exit gate:** MySQL + edge support shipped.

---

## M7 — v7.0 (~6 months after v6.0)

Goal: Studio.

### M7-S2 — `kick db studio`

As an **adopter**, I want a local schema browser at `/_db/studio`, so that I can inspect tables and run safe queries without external tools.

Acceptance:

- Studio served by the same DevTools route in dev.
- Schema view: tables → columns → indexes → FKs as a graph.
- Data view: paginated table browser with row edit (with confirmation).
- Query view: persistent saved queries per project.
- Disabled in production (404).

Touches: `packages/db/src/studio/`
Depends on: M6-S4

### M7-S3 — View / materialized view / enum / trigger introspection

As an **adopter**, I want `kick db introspect` to also pull views, materialized views, enums, and triggers, so that brownfield adoption isn't blocked on partial coverage.

Acceptance:

- Per-dialect introspectors extended.
- DSL gains `view(...)`, `materializedView(...)`, `enum(...)`, `trigger(...)` declarations.
- Diff engine handles them as first-class change types.
- Round-trip test: introspect-emit-apply-introspect on a complex PG schema.

Touches: `packages/db/src/dsl/`, `packages/db/src/snapshot/`, `packages/db/src/diff/`, `packages/db-pg/src/introspect.ts`
Depends on: M7-S2

**M7 exit gate:** v7.0 ships.

---

## Cross-cutting (continuous)

Stories that aren't milestone-locked. Ongoing work in parallel.

### CC-S1 — Dependency tracking

As a **maintainer**, I want a quarterly review of `kysely` upgrades, so that we don't fall behind on bug fixes and our peer-dep range stays current.

Acceptance: schedule a recurring agent for quarterly review.

### CC-S2 — User feedback channel

As a **maintainer**, I want a GitHub Discussions category for kickdb feedback, so that adopters can report issues and request features without forcing them through the issue tracker.

Acceptance: category created; pinned welcome post links the architecture spec; first-week issues triaged within 48h.

### CC-S3 — Bench drift detection

As a **maintainer**, I want CI to fail if microbench results regress >15% from the last release, so that performance gates land in PRs and not in production.

Acceptance: `benchmark-results.json` compared against `main` baseline; CI job fails on regression; manual override label `bench-skip` available with justification required.

---

## Summary

| Milestone                    | Stories | Estimated weeks |
| ---------------------------- | ------- | --------------- |
| M0 — Spike                   | 6       | 2               |
| M1 — Walking skeleton        | 10      | 4               |
| M2 — Type story + relational | 9       | 3               |
| M3 — SQLite + multi-dialect  | 7       | 3               |
| M4 — KickJS ecosystem fit    | 7       | 3               |
| M5 — Hardening + v6.0.0      | 5       | 2               |
| M6 — v6.1                    | 4       | 4–6             |
| M7 — v7.0                    | 2       | (months later)  |
| Cross-cutting                | 3       | continuous      |

**Total stories: ~52** across the lifecycle.

Stories carry dependency edges and acceptance criteria so any can be picked up independently when its blockers are clear. Add new stories at the end of their milestone section. Never re-number existing IDs.
