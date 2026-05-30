# @forinda/kickjs-db

## 6.0.0

## 6.0.0-alpha.0

### Patch Changes

- Updated dependencies [[`f04da5b`](https://github.com/forinda/kick-js/commit/f04da5b9ac7d496a57d357f2b8d4d2a2c9507e62), [`0d9a895`](https://github.com/forinda/kick-js/commit/0d9a8955f358f8ca8be8aca169dfa38285c48f50), [`a4fc68c`](https://github.com/forinda/kick-js/commit/a4fc68c991b996cae08800e7e9c1f0e8f39eaaeb)]:
  - @forinda/kickjs@5.14.0-alpha.0
  - @forinda/kickjs-devtools-kit@6.0.0-alpha.0

## 5.9.1

### Patch Changes

- [#271](https://github.com/forinda/kick-js/pull/271) [`860b366`](https://github.com/forinda/kick-js/commit/860b366c01dec4d3dfe6b8f3d90d75e534cff8d8) Thanks [@forinda](https://github.com/forinda)! - chore(meta): focus npm keywords per-package, drop sibling self-references

  Every published package's `keywords` array used to list the entire `@forinda/kickjs-*` family — `@forinda/kickjs-auth` had `@forinda/kickjs-drizzle`, `@forinda/kickjs-prisma`, `@forinda/kickjs-vite` etc. in its keywords, none of which describe what the auth package does. That's classic keyword stuffing: npm's search algorithm doesn't reward it, some implementations actively demote noisy packages, and it diluted the genuine signal for each package.

  Rewrote the keywords on all 19 published packages so each array describes **that specific package** — what a developer would actually type into npm search to find it. A shared 4-keyword header (`kickjs`, `nodejs`, `typescript`, `decorator-driven`) stays on each package so the family is still discoverable as a family. Removed: every `@forinda/kickjs-*` sibling self-reference, irrelevant `vite` from non-vite packages, irrelevant `framework` / `backend` / `api` from leaf adapters, and generic `database` / `query-builder` from packages where it doesn't add signal.

  No code change, no test impact. Metadata-only — npm search ranking will refresh on next publish.

## 5.9.0

### Minor Changes

- [#226](https://github.com/forinda/kick-js/pull/226) [`c42c33a`](https://github.com/forinda/kick-js/commit/c42c33aac8a40b18bcb7a2e71cba75f5acf21137) Thanks [@forinda](https://github.com/forinda)! - test(db): diff-engine fuzz harness — 1000 seeded round-trip property assertions

  Adds the diff-engine fuzz suite the original architecture spec ([§13](https://github.com/forinda/kick-js/blob/main/docs/db/architecture.md)) listed as an M5 hardening gate for the "production-grade" claim. 1000 randomly-generated `SchemaSnapshot` pairs run three structural property assertions against the diff engine:
  1. **Forward fidelity** — `applyChangeSet(A, diff(A, B)) ≡ B` for every pair. Catches missing changes (forward diff didn't notice some delta) and spurious changes (forward diff moves A away from B).
  2. **Reverse fidelity** — `applyChangeSet(B, invertChanges(diff(A, B))) ≡ A` when `hasAmbiguousReverse(forward)` is false. Ambiguous-reverse cases (`dropTable`, `dropColumn`, `alterColumn`, `addEnumValue`, `removeEnumValue`) are documented as best-effort drafts requiring operator review, so the property doesn't hold by design — those seeds are counted-and-skipped.
  3. **Reflexivity** — `diff(A, A) === []` for 1000 random snapshots. Catches a class of "always-emits-a-change" false-positives that would burn through migrations forever.

  Generator + applier scoped narrowly for the first cut:
  - PostgreSQL dialect only — other dialects share the same diff path; their emitters live in separate test scopes.
  - No `renameTable` / `renameColumn` (engine doesn't infer renames; those exercise the drop+add path, covered by `diff-rename.test.ts`).
  - Simple default values (`'0'`, `"'x'"`, `'true'`, `'CURRENT_TIMESTAMP'`) — avoids the pgEnum-cast-bracket dance that M5.A.1 handles.

  ### Finding from the first run

  The fuzz immediately surfaced an **internal contract** worth documenting: `diff/engine.ts` emits `createTable` changes carrying the full table snapshot (including indexes + FKs), then separately emits `addIndex` / `addForeignKey` for each. The SQL emitter `emit/pg.ts:emitCreateTable` strips indexes/FKs from the CREATE TABLE statement and renders them via the subsequent ALTER TABLE changes. The structural reader (the fuzz applier) has to mirror this stripping behaviour — taking the columns + PK from `createTable` and leaving indexes/foreignKeys empty until the secondary changes populate them. Not a bug — but the contract was implicit; the applier in `__tests__/fuzz/apply-changeset.ts` carries an inline note for the next reader.

  ### Surface bumps

  `@forinda/kickjs-db` minor — `EnumSnapshot` is now exported from the package root (oversight from M3; the rest of the snapshot type family was already public). Used by the fuzz generator but useful generally for adopters reading `SchemaSnapshot.enums`.

  ### Numbers

  `@forinda/kickjs-db`: **402 tests** (was 399 — three new fuzz top-level suites, each iterating 1000 seeds internally). Fuzz iteration cost: ~25 seconds for 3000 seed runs.

  Additive — no breaking change. Stays on the 5.x line.

## 5.8.0

### Minor Changes

- [#224](https://github.com/forinda/kick-js/pull/224) [`707e6ba`](https://github.com/forinda/kick-js/commit/707e6ba741d1b25e79fdfd164463346a372c9745) Thanks [@forinda](https://github.com/forinda)! - feat(db): `safeNullComparison()` plugin — kickjs-side workaround for Kysely's broken upstream

  `@forinda/kickjs-db` now exports its own `safeNullComparison()` plugin. Wire it through `createDbClient({ plugins: [...] })` so `eb('col', '=', null)` (plus `!=` / `<>`) compiles to `IS NULL` / `IS NOT NULL` instead of the silently-false `= NULL` default.

  ```ts
  import { createDbClient, safeNullComparison } from '@forinda/kickjs-db'

  const db = createDbClient({
    schema,
    dialect: pgDialect({ pool }),
    plugins: [safeNullComparison()],
  })

  await db.selectFrom('users').where('deletedAt', '=', null).selectAll().execute()
  // → SQL: select * from "users" where "deletedAt" is null   (no parameter)
  ```

  The kickjs version emits the literal `null` keyword inline using `ValueNode.createImmediate(null)`, producing valid PostgreSQL. Pass this — NOT Kysely's `SafeNullComparisonPlugin` — through `plugins`. The Kysely upstream version is broken on PG (rewrites the operator but keeps the null operand parameterised, producing `WHERE "col" IS $1` which PG rejects with `syntax error at or near "$1"`); tracked upstream at <https://github.com/forinda/kick-js/issues/220>.

  When upstream Kysely fixes their transformer, this kickjs wrapper can collapse to a one-line re-export of Kysely's plugin.

  Tests: 7 new unit cases in `packages/db/__tests__/unit/safe-null-comparison.test.ts` (broken-default lock, `=` / `!=` / `<>` rewrite + non-null-passthrough + `is` passthrough). 3 new integration cases in `packages/db-pg/__tests__/integration/kysely-safe-null-broken-pg.test.ts` — Testcontainers PG 16 row-level verification. The existing locks on Kysely's broken upstream behaviour stay so an upstream fix surfaces loudly.

  `@forinda/kickjs-db`: 399 tests (was 392). `@forinda/kickjs-db-pg`: 35 tests (was 32). Patch on `@forinda/kickjs-db-pg` (test-only — no src change in the peer adapter).

  Additive — no breaking change.

## 5.7.0

### Minor Changes

- [#212](https://github.com/forinda/kick-js/pull/212) [`eb06da2`](https://github.com/forinda/kick-js/commit/eb06da2eb397a68fd577dd0deb312187dcca49db) Thanks [@forinda](https://github.com/forinda)! - feat(db): `AbortSignal` threading on `db.query.*` + `RelationalQueryCancelledError` (M5.A.2)

  `FindManyOptions` / `FindFirstOptions` / `FindUniqueOptions` accept a new optional `signal: AbortSignal`. Bind to `RequestContext.signal` from kickjs-http to short-circuit relational queries when the client disconnects or the request times out — no more wrapping every call site in a manual `Promise.race`.

  ```ts
  @Service()
  export class TasksRepository {
    constructor(@Inject(DB_PRIMARY) private readonly db: KickDbClient) {}

    findFullById(id: string, signal: AbortSignal) {
      return this.db.query.tasks.findUnique({
        where: (_t, eb) => eb('id', '=', id),
        with: { comments: true, assignees: true, labels: true },
        signal,
      })
    }
  }

  @Controller()
  export class TasksController {
    constructor(private readonly tasks: TasksRepository) {}
    @Get('/tasks/:id')
    async show(ctx: RequestContext) {
      return ctx.json(await this.tasks.findFullById(ctx.params.id, ctx.signal))
    }
  }
  ```

  When the signal fires, the promise rejects with the new `RelationalQueryCancelledError` (extends `KickDbError`, code `relational_query_cancelled`). The signal's `reason` flows onto the error's `cause` field so adopters can inspect upstream causes (HTTP timeout vs explicit cancel vs user disconnect).

  Already-aborted signals short-circuit before any compile or DB round trip. Driver-level AbortError shapes (DOM `AbortError`, PG SQLSTATE `57014`, mysql2 `EAGAIN_QUERY_INTERRUPTED`, better-sqlite3 `SQLITE_INTERRUPT`) are normalised to `RelationalQueryCancelledError`. Unrelated rejections pass through verbatim.

  Default cancellation strategy is Kysely 0.29's `'ignore query'` — JS-side promise rejects, DB-side query keeps running until completion. The stricter `'cancel query'` (`pg_cancel_backend` / `KILL QUERY`) requires per-dialect support and isn't safe to default across all peer adapters yet; adopters who need it drive Kysely directly via `db.qb`. A future minor may surface a per-call override.

  Spec: [`docs/db/spec-abortsignal-threading.md`](https://github.com/forinda/kick-js/blob/main/docs/db/spec-abortsignal-threading.md). Tests: 11 new unit cases in `packages/db/__tests__/unit/abort-signal-unit.test.ts` + 3 PG integration cases (`packages/db-pg/__tests__/integration/abort-signal-pg.test.ts`) + 3 SQLite cases (`packages/db-sqlite/__tests__/integration/abort-signal-sqlite.test.ts`).

  Additive — no breaking change. M5 "no major bumps" rule respected.

- [#218](https://github.com/forinda/kick-js/pull/218) [`c695340`](https://github.com/forinda/kick-js/commit/c6953404b14ea9b0fc9f5ff0951849418c32d482) Thanks [@forinda](https://github.com/forinda)! - feat(db): re-export `ReadonlyKysely` + document `$pickTables` / `$omitTables` narrowing (M5.A.3)

  Kysely 0.29 ships three compile-time narrowing helpers — `$pickTables<...>()`, `$omitTables<...>()`, and the `ReadonlyKysely<DB>` type. They're reachable today through `KickDbClient`'s `db.qb` escape hatch, but adopters who hit them through the bare `@forinda/kickjs-db` import path got no autocomplete and no obvious entry point. M5.A.3 surfaces the type:

  ```ts
  import type { KickDbClient, ReadonlyKysely } from '@forinda/kickjs-db'
  import type { KickDb } from '../db/schema' // your SchemaToTypes alias

  @Service()
  export class WorkspacesQueryRepository {
    private readonly reader: ReadonlyKysely<KickDb>

    constructor(@Inject(DB_PRIMARY) db: KickDbClient<KickDb>) {
      this.reader = db.qb as unknown as ReadonlyKysely<KickDb>
    }

    list() {
      return this.reader.selectFrom('workspaces').selectAll().execute()
    }

    // this.reader.insertInto('workspaces') → compile error:
    //   Argument of type ... is not assignable to parameter of type
    //   'KyselyTypeError<"not allowed with a read-only Kysely instance.">'
  }
  ```

  Same pattern for table-set narrowing inside a repo:

  ```ts
  private get reader() {
    return this.db.qb.$pickTables<'workspaces' | 'workspace_members'>()
  }
  // reader.selectFrom('projects') → compile error, table picked out
  ```

  `ReadonlyKysely` keeps `insertInto` / `updateTable` / `deleteFrom` / `mergeInto` visible in autocomplete, but every call site is typed to return a poisoned `KyselyTypeError<'not allowed with a read-only Kysely instance.'>` sentinel — so the IDE still surfaces the method names while any actual write fails to compile. Pairs cleanly with the `DB_PRIMARY` / `DB_REPLICA` split for read-replica routing.

  Adopter doc: [`docs/guide/db-relational-query.md#narrowing-the-client`](https://github.com/forinda/kick-js/blob/main/docs/guide/db-relational-query.md#narrowing-the-client). Tests: 7 type-only `expectTypeOf` cases in `packages/db/__tests__/unit/pick-tables-types.test.ts`.

  Additive — no breaking change. M5 "no major bumps" rule respected.

- [#219](https://github.com/forinda/kick-js/pull/219) [`69a7126`](https://github.com/forinda/kick-js/commit/69a71269f60c1fb1b07bc687ed916da51ab086fa) Thanks [@forinda](https://github.com/forinda)! - feat(db): ALTER TYPE typed-IR helpers + `plugins?` opt-in (M5.B)

  Two pieces of internal / Kysely-0.29-surface work bundled into one minor.

  ### M5.B.1 — typed-IR helpers for `ALTER TYPE`

  The four PG `ALTER TYPE` shapes the migration emitter produces (`RENAME TO`, `ADD VALUE`, `ADD VALUE BEFORE/AFTER`, `RENAME VALUE`) now flow through a typed IR (`AlterTypeIr`) in `packages/db/src/emit/alter-type.ts` plus one renderer. Emitted SQL is byte-identical to pre-refactor output — existing snapshot tests + every adopter's `_journal.json` migration hash continue to lock the uppercase form. Kysely 0.29's `db.schema.alterType(...).compile().sql` emits lowercase keywords (`alter type "foo" rename to ...`), so the helpers model Kysely's `AlterTypeNode` shape but render via the local emitter rather than Kysely's `PostgresQueryCompiler`.

  Future enum-related work (value-rename, schema-move) now has one source of truth instead of scattered string-builds across `emit/pg.ts`.

  Internal helpers — not surfaced on the public `package.json` exports map. Tests reach them through the `@forinda/kickjs-db/emit/alter-type` vitest alias.

  ### M5.B.2 — `plugins?: KyselyPlugin[]` option

  `CreateDbClientOptions` gains an additive `plugins?: KyselyPlugin[]` field — adopter plugins append after the built-in chain (`CodecPlugin` for `customType` mappers, `ParseJSONResultsPlugin` for SQLite + MySQL JSON decoding). Unset = byte-identical chain to pre-M5.B clients.

  ```ts
  import { createDbClient } from '@forinda/kickjs-db'
  import { CamelCasePlugin } from 'kysely'

  const db = createDbClient({
    schema,
    dialect: pgDialect({ pool }),
    plugins: [new CamelCasePlugin()],
  })
  ```

  **Heads-up — Kysely 0.29's `SafeNullComparisonPlugin` ships broken on PG.** Verified empirically against `postgres:16-alpine` on this PR. The plugin rewrites `=` / `!=` against literal `null` to `IS` / `IS NOT` but keeps the null as a parameterised `ValueNode`, producing `WHERE "col" IS $1` with `$1=null` — which PG rejects with `syntax error at or near "$1"`. The original `safeNullComparison()` wrapper we'd planned to ship in this minor was pulled for that reason (would surface a runtime error instead of the silently-false comparison — arguably worse than the broken default). The `CreateDbClientOptions.plugins` docstring carries the warning + the recommended workaround (use the explicit `'is'` / `'is not'` operators directly via the Kysely expression builder).

  `packages/db-pg/__tests__/integration/kysely-safe-null-broken-pg.test.ts` locks the upstream-broken behaviour so an upstream Kysely fix (or our re-introduction of a fixed kickjs-side wrapper) surfaces here.

  ### Tests
  - 6 new unit cases in `packages/db/__tests__/unit/alter-type-helpers.test.ts` — covers the three IR builders + the `before` / `after` mutual-exclusion guard + identifier quoting.
  - 4 new integration cases in `packages/db-pg/__tests__/integration/kysely-safe-null-broken-pg.test.ts` — Testcontainers PG 16, raw protocol + end-to-end via `createDbClient({ plugins })`, plus the recommended `'is'` / `'is not'` workaround verification.
  - The existing pg-enum-pipeline + default-preservation snapshot tests continue to gate byte-identity of the ALTER TYPE refactor.

  `@forinda/kickjs-db`: **392 tests** (was 386 at M5.A.3 cut). `@forinda/kickjs-db-pg`: **32 tests** (was 28). Additive — no breaking change. M5 "no major bumps" rule respected.

### Patch Changes

- [#210](https://github.com/forinda/kick-js/pull/210) [`ac74a73`](https://github.com/forinda/kick-js/commit/ac74a73e8c8c2e92565cf3f2b535045a23cce30d) Thanks [@forinda](https://github.com/forinda)! - fix(db): preserve column DEFAULT through `pgEnum` rename-recreate (M5.A.1)

  Adopters whose schemas declared `column.notNull().default('active')` on an enum-typed column couldn't run the M3.B value-removal flow — PG refused the `ALTER COLUMN TYPE … USING …` cast with `default for column X cannot be cast automatically`. Fix: `emitRemoveEnumValueRecreate` now wraps the type swap in `DROP DEFAULT` / `SET DEFAULT 'value'::"<enum>"` brackets when the affected column carries a default.

  Columns without a default emit the bare swap — output is byte-identical to pre-M5.A.1, so existing applied migrations keep their journal hashes.

  New `RemovedValueAsDefaultError` is raised at `kick db generate` time when the column's default is itself one of the values being removed (the SET DEFAULT step would fail anyway). The operator must update the column default in the schema before re-running generate.

  Spec: [`docs/db/spec-default-preservation.md`](https://github.com/forinda/kick-js/blob/main/docs/db/spec-default-preservation.md). Integration test: `packages/db-pg/__tests__/integration/enum-drop-with-default.test.ts`.

## 5.6.0

### Minor Changes

- [#205](https://github.com/forinda/kick-js/pull/205) [`f9e24a5`](https://github.com/forinda/kick-js/commit/f9e24a591b1174f50deeec2567082f2194f77555) Thanks [@forinda](https://github.com/forinda)! - chore(db): bump kysely from `0.28.16` to `0.29.0` across the db family

  Direct + peer ranges bumped on `@forinda/kickjs-db`, `@forinda/kickjs-db-pg`, `@forinda/kickjs-db-mysql`, `@forinda/kickjs-db-sqlite`. Adopters who pin `kysely@0.28.x` need to update their lockfile; nothing else.

  Why minor: the peer floor moves from `^0.28.16` to `^0.29.0`, so adopters bumping `@forinda/kickjs-db` get a transitive Kysely major. No source changes were required for the upgrade — the breaking-change list audited clean against kickjs-db's surface:
  - `sql.value` / `sql.literal` removed → not used.
  - `numUpdatedOrDeletedRows` → not used.
  - `executeQuery(query, queryId)` → `(query, options?)` — kickjs's call site (`packages/db/src/query/builder.ts`) passes one arg, which stays compatible.
  - Migration exports relocated to `kysely/migration` — kickjs uses its own `MigrationAdapter` contract, doesn't import `Migrator` / `FileMigrationProvider`.
  - TS 5.4 floor → repo on TS 6.0.3.
  - CommonJS dropped → kickjs is ESM-first via tsdown; CJS-interop adopters pinned to `kysely@0.28.x` need to plan their own migration.

  Adopter-facing wins now reachable through `KickDbClient`:
  - `$pickTables<...>()` / `$omitTables<...>()` for compile-time schema narrowing.
  - `ReadonlyKysely` — type-level read-only client that prevents `insert`/`update`/`delete`/`merge` at compile time.
  - `AbortSignal` query cancellation — composable with `RequestContext.signal` (a future kickjs-db release will thread it through `db.query.X.findMany` natively).
  - `eb.case().thenRef` / `whenRef(lhs, op, rhs)` / `elseRef`.
  - ALTER TYPE PG node — opens the door to a follow-up that simplifies the M3.B `removeEnumValue` emitter.
  - `SafeNullComparisonPlugin` — `= null` → `IS NULL` automatically.
  - `with(name, query)` shape on CTEs.

  Test matrix: db (359), db-pg (24), db-mysql (34), db-sqlite (10), cli (276) — all green on `kysely@0.29.0`.

## 5.5.0

### Minor Changes

- [#200](https://github.com/forinda/kick-js/pull/200) [`3dbdd06`](https://github.com/forinda/kick-js/commit/3dbdd06ba8dcf207d5bd4a5dc595c2d3e529182f) Thanks [@forinda](https://github.com/forinda)! - feat(db): refuse `pgEnum` value removal when a composite type references the enum (M4.C)

  The M3.B rename-recreate dance assumes the enum is referenced only by table columns. PG composite types / arrays-of-composite / domains containing the enum break that approach — the `ALTER COLUMN TYPE … USING column::text::foo` clause can't reach into composite fields, so the migration would fail opaquely at apply time.

  Generate-time gate added: when `kick db generate` produces one or more `removeEnumValue` changes, the CLI queries `pg_type` + `pg_attribute` against the configured PG connection. If any composite type holds the enum (directly or as an array element), it refuses to write the migration with a new `CompositeEnumReferenceError` listing every offending `<composite>.<attribute>`.

  The check runs only on the built-in pgAdapter path (`dialect: 'postgres'` + `connectionString`/`DATABASE_URL`). Adopters using the `db.adapter` factory escape hatch get the helper exported from `@forinda/kickjs-db` (`detectCompositeReferences`, `CompositeQueryRunner`, `CompositeRef`) so they can wire it themselves.

  No behavior change when no composite references the enum; no behavior change for non-PG dialects.

## 5.4.1

### Patch Changes

- [#186](https://github.com/forinda/kick-js/pull/186) [`8f9c153`](https://github.com/forinda/kick-js/commit/8f9c1533aa0d865b472f93fd02c174799d4767d8) Thanks [@forinda](https://github.com/forinda)! - Two new peer adapter packages closing M4.A.5 from `docs/db/m4-plan.md`.

  ## `@forinda/kickjs-db-sqlite` (initial release: 0.1.0)

  better-sqlite3 adapter for `@forinda/kickjs-db`. Mirrors the `@forinda/kickjs-db-pg` template:
  - **`sqliteDialect({ database })`** — wraps Kysely's `SqliteDialect`. Pair with `createDbClient({ schema, dialect })`.
  - **`sqliteAdapter({ database })`** — implements `MigrationAdapter` for the kickjs migration runner (`kick db migrate latest`, `kickDbAdapter` boot-time apply). Handles `kick_migrations` / `kick_migrations_lock` table creation, lock acquisition, applying SQL in / out of a transaction.
  - **Pairs with the SQLite relational compiler** that landed in `@forinda/kickjs-db@5.4.0` (M4.A.2). `db.query.X.findMany({ with })` round-trips correctly via the auto-attached `ParseJSONResultsPlugin`.
  - **Drift detection (`introspect()`)** is a follow-up — throws `KICK_DB_INTROSPECT_NOT_SUPPORTED` for now. Set `driftCheck: 'off'` until the `sqlite_master` + `pragma` walk lands.

  ```ts
  import Database from 'better-sqlite3'
  import { createDbClient } from '@forinda/kickjs-db'
  import { sqliteAdapter, sqliteDialect } from '@forinda/kickjs-db-sqlite'

  const database = new Database('app.db')
  const db = createDbClient({ schema, dialect: sqliteDialect({ database }) })
  const migrationAdapter = sqliteAdapter({ database })
  ```

  ## `@forinda/kickjs-db-mysql` (initial release: 0.1.0)

  mysql2 adapter for `@forinda/kickjs-db`. **MySQL 8.0+ / MariaDB 10.5+ required** (the relational layer compiles to `JSON_ARRAYAGG`, which shipped in MySQL 8.0 and MariaDB 10.5).
  - **`mysqlDialect({ pool })`** — wraps Kysely's `MysqlDialect`.
  - **`mysqlAdapter({ pool })`** — implements `MigrationAdapter`. Asserts the version on first connection (lazy — no I/O at construction time). Throws `KickDbError(KICK_DB_RELATIONAL_NOT_SUPPORTED)` on MySQL 5.x / MariaDB 10.0–10.4 / unparseable version strings, with the detected version in the error message.
  - **Per-flavor version floor** — MySQL needs major `>= 8`; MariaDB needs `>= 10.5`. The adapter detects the flavor from the version string and applies the right floor.
  - **Multi-statement splitter** — mysql2's default `Pool.query()` rejects multi-statement SQL unless `multipleStatements: true` is set. The adapter splits SQL blobs at top-level `;` boundaries (respecting string literals + `--` and C-style block comments) so kickjs-generated migrations apply out of the box.
  - **`parseMysqlVersion(version)`** + **`parseMysqlMajorVersion(version)`** + **`splitMysqlStatements(sql)`** — all exposed for adopters who want the same checks / splitter in their own boot logic.
  - **Drift detection** is a follow-up — same `KICK_DB_INTROSPECT_NOT_SUPPORTED` story as the SQLite adapter; the `information_schema` walk lands later.

  ```ts
  import { createPool } from 'mysql2/promise'
  import { createDbClient } from '@forinda/kickjs-db'
  import { mysqlAdapter, mysqlDialect } from '@forinda/kickjs-db-mysql'

  const pool = createPool({ host, user, password, database })
  const db = createDbClient({ schema, dialect: mysqlDialect({ pool }) })
  const migrationAdapter = mysqlAdapter({ pool })
  ```

  ## `@forinda/kickjs-db` + `@forinda/kickjs-db-pg` (patch — keyword sweep)

  Patch bumps for a metadata-only sweep across the db-family packages. Every package in `@forinda/kickjs-*` now declares the consistent keyword set: `kickjs` (for plain-text npm search), `@forinda/kickjs` (the framework), the package's own name, and the related-package siblings — so adopters discover SQLite + MySQL alongside the PG adapter on npmjs.com. No code changes; no API surface changes.

  ## What's tested
  - `@forinda/kickjs-db-sqlite`: 10 real-driver integration tests using in-memory `better-sqlite3` — relational query round-trip (2-deep nested `with`, empty inner sets, `findFirst`/`findUnique`, per-relation filters, JSON parse plugin auto-attach) + migration adapter contract (table creation, applied-row lifecycle, lock acquisition, introspect-throws).
  - `@forinda/kickjs-db-mysql`: 11 unit tests covering the version-string parser + the version-assertion gate (MySQL 8 / MariaDB 10 pass, MySQL 5.7 / unparseable throw, version check is cached after first success). Real-driver Testcontainers integration test ships in a follow-up to keep CI cheap.

  ## What's deferred
  - Real-driver Testcontainers MySQL integration test — dropped to a follow-up so this PR stays cheap to run on every push.
  - `introspect()` for both dialects — the migration runner's drift check refuses without it; adopters set `driftCheck: 'off'` until follow-up impls land.

## 5.4.0

### Minor Changes

- [#185](https://github.com/forinda/kick-js/pull/185) [`c601090`](https://github.com/forinda/kick-js/commit/c60109029a59694da9478dd714cb9aea684765fe) Thanks [@forinda](https://github.com/forinda)! - `db.query.X.findMany({ with })` now works on MySQL 8.0+. M4.A.3 from `docs/db/m4-plan.md` — closes the "PG only" caveat that started in v5.3 and shrank with M4.A.2 (SQLite). All three dialects now ship real compilers; the `RelationalQueryNotSupportedError` throw-stub is retired.

  ```ts
  const db = createDbClient({ schema, dialect: mysqlDialect({ pool }) })

  const rows = await db.query.users.findMany({
    with: { posts: { with: { comments: true } } },
    where: (_u, eb) => eb('isActive', '=', true),
    limit: 20,
  })
  ```

  The compiler emits `cast(coalesce(json_arrayagg(json_object(...)), '[]') as json)` for `many` (returns `[]` over zero rows, never `null`) and `JSON_OBJECT(...)` with `LIMIT 1` for `one` (returns `null` over zero rows). Same row-shape contract as PG and SQLite.

  **MySQL 8.0+ required.** `JSON_ARRAYAGG` shipped in 8.0; earlier versions don't have it. The version assertion lands at the adapter layer (`mysqlAdapter()` from `@forinda/kickjs-db-mysql` — M4.A.5) on first connection so adopters get a clear error before any query reaches the compiler. v1 spec R-1.

  **`createDbClient` auto-attaches `ParseJSONResultsPlugin` for MySQL** (alongside SQLite). MySQL drivers return JSON columns as TEXT — without the plugin, nested `with` results would land as JSON-encoded strings.

  **`pickCompiler('mysql')`** now returns the real implementation. The throw-stub is gone; all three dialects are first-class.

  **Adopter migration:** none for `db.query.X.findMany`-based usage. Adopters who previously caught `RelationalQueryNotSupportedError` for a MySQL fallback can remove that branch — the compiler now succeeds.

  Spec: `docs/db/spec-relational-query-other-dialects.md` §3.2. Tests: 13 new MySQL snapshot fixtures mirroring the PG + SQLite suites + 2 new builder integration tests asserting the MySQL path via `kysely/helpers/mysql`. Suite at 341 tests (was 327; +14).

- [#183](https://github.com/forinda/kick-js/pull/183) [`6be566a`](https://github.com/forinda/kick-js/commit/6be566a636fe1bbdd3c0b6b56d048f34c2c759e0) Thanks [@forinda](https://github.com/forinda)! - Add `relationName: 'foo'` to `relations()` for multi-FK disambiguation. Resolves the drizzle-parity gap where two tables share more than one FK to the same target — `messages.senderId` + `messages.recipientId` both referencing `users.id`, with `users.sentMessages` + `users.receivedMessages` walking back the other way.

  After this release, adopters tag matching pairs with the same string:

  ```ts
  relations(messages, ({ one }) => ({
    sender: one(users, {
      fields: [messages.senderId],
      references: [users.id],
      relationName: 'sentMessages',
    }),
    recipient: one(users, {
      fields: [messages.recipientId],
      references: [users.id],
      relationName: 'receivedMessages',
    }),
  }))

  relations(users, ({ many }) => ({
    sentMessages: many(messages, { relationName: 'sentMessages' }),
    receivedMessages: many(messages, { relationName: 'receivedMessages' }),
  }))
  ```

  The resolver pairs by name first; M3's single-inverse + FK-introspection fallbacks remain for schemas that don't need the disambiguation.

  **Resolution precedence** (`extractRelations`):
  1. Both sides declare matching `relationName` → use the matched `one`'s columns.
  2. Single untagged inverse `one` (no `relationName` on either side, exactly one `one` on the target points back at the source) → use it.
  3. FK introspection — exactly one FK back to the source → use those columns.
  4. Throw `RelationalQueryMissingInverseError` with a hint to add `relationName`.

  **Behavior change vs M3:** Step 2 now requires the inverse to be **unique**. M3's `findInverseOne` returned the first match without a uniqueness check, which silently picked wrong on multi-FK schemas. M4.B makes those schemas surface as `MissingInverseError` instead of silently joining the wrong way. Single-FK schemas (the common case) behave identically.

  **New public surface:**
  - `Helpers.one`'s opts gain optional `relationName?: string`.
  - `Helpers.many`'s second arg becomes optional `{ relationName?: string }` (was required-positional `target` only).
  - `RelationOne<T>` + `RelationMany<T>` interfaces gain optional `relationName?: string`.
  - `RelationMapEntry` (and the `KickDbRelationsRegister` augmentation it composes) gain optional `relationName?: string`. The kick/db typegen plugin auto-emits the new field through `SchemaToRelationsRegister<S>` — no plugin update needed.
  - `RelationSnapshot` (`SchemaSnapshot.relations[*][*]`) gains optional `relationName?: string` for adopters reading the snapshot programmatically.
  - New error class `RelationalQueryAmbiguousRelationNameError` — thrown when two `one` declarations on the same target share a `relationName` AND point back at the same source. Scope: `(sourceTable, targetTable, relationName)` — adopters can reuse the same tag string across unrelated table pairs (e.g. a generic `'audit'` tag on multiple tables).

  **Migration:** none required for existing schemas. The `relationName` field is optional everywhere; M3 schemas keep compiling unmodified.

  Spec: `docs/db/spec-relation-name.md`. Tracks closing M4.B from `docs/db/m4-plan.md`.

- [#184](https://github.com/forinda/kick-js/pull/184) [`64ff558`](https://github.com/forinda/kick-js/commit/64ff558a2f1cee096f040a93b44d8eb68cd73255) Thanks [@forinda](https://github.com/forinda)! - `db.query.X.findMany({ with })` now works on SQLite. M4.A.2 from `docs/db/m4-plan.md` — closes the "PG only" caveat for SQLite adopters; MySQL ships in M4.A.3.

  The `pickCompiler('sqlite')` path now returns a real implementation (`compileSqlite`) backed by `kysely/helpers/sqlite`'s `jsonArrayFrom` / `jsonObjectFrom`. Same call shape as the PG layer; no adopter code changes:

  ```ts
  const db = createDbClient({ schema, dialect: sqliteDialect({ database }) })

  const rows = await db.query.users.findMany({
    with: { posts: { with: { comments: true } } },
    where: (_u, eb) => eb('isActive', '=', true),
    limit: 20,
  })
  ```

  The compiler emits `coalesce(json_group_array(json_object(...)), '[]')` for `many` (returns `[]` over zero rows, never `null`) and `json_object(...)` with `LIMIT 1` for `one` (returns `null` over zero rows). Same row-shape contract as PG.

  **`createDbClient` auto-attaches `ParseJSONResultsPlugin` for SQLite.** SQLite drivers return JSON columns as TEXT; without the plugin, nested `with` results would land as JSON-encoded strings. Adopters who already register the plugin manually pay no penalty — the plugin chain runs each plugin in order, and a second pass over already-parsed values is a no-op. PG clients skip the plugin (the PG driver decodes JSON natively).

  **Refactor — shared traversal.** Internally, `compile-pg.ts` and `compile-sqlite.ts` are now thin wrappers around `compile-shared.ts`'s `runCompile()`. The traversal logic (alias generation, `with`-walking, `where` / `orderBy` / `limit` / `offset` plumbing) lives in one place; per-dialect files supply only the right Kysely helper bag. MySQL drops in the same way once M4.A.3 lands.

  **Behavior change in `buildInnerSelect`** — emits explicit `.select([col1, col2, ...])` from the snapshot's column list instead of `.selectAll()`. Required because SQLite's `jsonArrayFrom` / `jsonObjectFrom` helpers can't introspect `selectAll()` to build the JSON object's key list. PG's helpers accept both forms; this change is invisible to adopters but produces slightly more verbose SQL on PG.

  **Internal refactor note:** the shared compiler path now threads a `tables: Record<string, TableSnapshot>` map alongside `relations` when calling `runCompile()`. `createDbClient`-based call sites are unaffected — `extractSnapshot` already produces the map and threads it through `InternalContext.query.tables`. The dialect-specific compilers (`compilePg`, `compileSqlite`) are not exported from the package barrel, so this signature change is internal.

  **Adopter migration:** none for supported public APIs, including `db.query.X.findMany`-based usage.

  Spec: `docs/db/spec-relational-query-other-dialects.md`. Tests: 13 new SQLite snapshot fixtures mirroring the PG suite + 2 new builder integration tests asserting the SQLite path via `kysely/helpers/sqlite`. Suite at 326 tests (was 312; +14).

## 5.3.0

### Minor Changes

- [#178](https://github.com/forinda/kick-js/pull/178) [`45fd19d`](https://github.com/forinda/kick-js/commit/45fd19da8ad2856d1ac591b25a112098f9f642ca) Thanks [@forinda](https://github.com/forinda)! - Lossless removal of `pgEnum` values. Previously `kick db generate` emitted a multi-line `--` comment for value removals and the migration ran cleanly with **silent data loss** — the database kept the old value list. The next `kick db generate` cycle would surface the drift, but never the actual removal.

  After this release, removing a value from `pgEnum(...)` produces a real migration carrying the rename-recreate dance:

  ```sql
  -- KICK ENUM REMOVE
  -- enum: "task_priority"
  -- removed: 'unused', 'archived'
  -- columns: tasks.priority
  --
  -- This migration drops values from a PostgreSQL ENUM type. The
  -- runner refuses to apply it without the --confirm-enum-drop flag
  -- (or `confirmEnumDrop: true` in RunnerOptions). Inspect the
  -- column USING clauses below to confirm rows holding a removed
  -- value will fail loudly rather than silently coerce.

  BEGIN;
    ALTER TYPE "task_priority" RENAME TO "task_priority__old";
    CREATE TYPE "task_priority" AS ENUM ('critical', 'high', 'medium', 'low', 'none');
    ALTER TABLE "tasks"
      ALTER COLUMN "priority" TYPE "task_priority"
      USING "priority"::text::"task_priority";
    DROP TYPE "task_priority__old";
  COMMIT;
  ```

  The `-- KICK ENUM REMOVE` literal at the top is the runner's gate signal. `kick db migrate latest` (and `kick db migrate up`) now refuse to apply such migrations unless `--confirm-enum-drop` is passed (or `confirmEnumDrop: true` is set on `RunnerOptions` in adopter code). Without the flag, `MigrationEnumDropError` fires with the affected enums / values / columns _before any DB write_.

  The `USING column::text::foo` clause does the safety check: if any row holds a removed value, the cast fails and the whole transaction rolls back. Operators who need to map removed values to a replacement first must hand-roll a pre-migration that does the data update before generating the structural removal.

  **New public API on `@forinda/kickjs-db`:**
  - `RunnerOptions.confirmEnumDrop?: boolean` — opt-in flag for the runner.
  - `MigrationEnumDropError` — thrown by the gate; carries `id`, `enums`, `removed`, `columns`.
  - `parseEnumDropHeader(sql)` / `enforceEnumDropGate(id, sql, confirmEnumDrop)` / `EnumDropHeader` — exposed for adopters who run migrations through their own tooling and want the same gate semantics.
  - `RemoveEnumValue` change kind extended with `values: readonly string[]` + `affectedColumns: readonly { table: string; column: string }[]`. Adopters reading the diff output programmatically gain access to both the new value list and the column round-trip targets.

  **New CLI flag:** `kick db migrate latest --confirm-enum-drop` (and `kick db migrate up --confirm-enum-drop`). Down-direction commands (`down`, `rollback`) do **not** require the flag — reversing a value removal is `ALTER TYPE … ADD VALUE` per dropped value, which is always cheap.

  **Migration notes for adopters who hand-roll migrations:** none. Existing migrations without the header literal are unaffected. The runner gate is opt-in by header presence; ordinary migrations skip the parse entirely (substring check).

  Spec: `docs/db/spec-enum-value-removal.md`.

- [#178](https://github.com/forinda/kick-js/pull/178) [`efebe58`](https://github.com/forinda/kick-js/commit/efebe584147c2ed97c2741c49efe29164d2976d6) Thanks [@forinda](https://github.com/forinda)! - The kick/db typegen plugin now emits a `KickDbRelationsRegister` augmentation alongside the existing `KickDbSchema` + `KickDbRegister`, so `db.query.X.findMany({ with })` call sites get typed `with` keys without a hand-rolled augmentation file.

  After upgrading + running `kick typegen` (or `kick dev`), `.kickjs/types/kick__db.d.ts` carries:

  ```ts
  declare module '@forinda/kickjs-db' {
    interface KickDbRegister {
      db: KickDbClient<KickDbSchema>
    }

    interface KickDbRelationsRegister {
      db: SchemaToRelationsRegister<typeof appSchema>
    }
  }
  ```

  `SchemaToRelationsRegister<S>` is a new public type-level helper exported from `@forinda/kickjs-db`. It walks the schema barrel for `relations()` declarations and folds them into the registry shape — keyed by source table, each entry mapping `relationName → { kind, target }` with the target shrunk to the literal table name. Adding or removing a relation in `src/db/schema/relations.ts` flows through to call-site type-checking automatically.

  **Type-only refactor on `relations()`:**

  `relations(source, builder)` and the `Helpers.one` / `Helpers.many` factories now preserve the source name and target literal at the type level. The runtime shape is unchanged and all existing call sites remain assignable to the prior less-specific signature; this is strictly a narrowing improvement that makes `SchemaToRelationsRegister<S>` derivable.

  Specifically:
  - `relations()` returns `RelationsDecl<TSourceName, TRelationsMap>` (was `RelationsDecl`).
  - `Helpers.one` returns `RelationOne<TTarget>` (was `RelationOne`).
  - `Helpers.many` returns `RelationMany<TTarget>` (was `RelationMany`).

  Adopters who match against the old return types via `extends RelationsDecl` keep working — both new generics default to the prior open shape.

  **Migration:** Adopters who hand-rolled `KickDbRelationsRegister` augmentations as a stop-gap (suggested in M3.A.5 docs) can delete those files once typegen runs. The auto-emitted shape matches what was hand-written.

- [#178](https://github.com/forinda/kick-js/pull/178) [`0a63cfc`](https://github.com/forinda/kick-js/commit/0a63cfc90cdc02c94dbdd410ac5f46d1952c3d06) Thanks [@{](https://github.com/{)! - Land the runtime surface for `db.query.X.findMany({ with })`. After this release, adopters call the relational read API directly off the client returned by `createDbClient`:

  ```ts
  const db = createDbClient({ schema, dialect: pgDialect({ pool }) })

  const rows = await db.query.users.findMany({
    with: { posts: { with: { comments: true } } },
    where: (u, eb) => eb('isActive', '=', true),
    limit: 20,
  })
  ```

  PostgreSQL only in this release. SQLite and MySQL clients throw `RelationalQueryNotSupportedError` on first call — a M4-tracked compiler lands in a follow-up.

  **New runtime pieces:**
  - `KickDbClient<DB>.query: QueryNamespace<DB>` — Proxy-based namespace. Materializes per-table sub-namespaces on first access (`findMany` / `findFirst` / `findUnique`).
  - `extractSnapshot` now populates an optional `SchemaSnapshot.relations` sidecar from `relations()` declarations. JSON-serializable; the migration pipeline ignores it. `many` relations resolve via the inverse `one` if declared, falling back to FK introspection so M0/M1 schemas keep working without rewrites.
  - `createDbClient` calls `extractSnapshot` once at boot, picks the dialect-specific compiler, and threads both into the client. Adopters write zero extra code.
  - `detectDialect` now also inspects the adapter class returned by `createAdapter()`, so hand-rolled `KyselyDialect` literals (common in tests) are recognized as PG / MySQL / SQLite correctly.

  **New public exports** from `@forinda/kickjs-db`:
  - Types: `FindManyOptions<DB, Table>`, `FindManyRow<DB, Table, Opts>`, `WithClause<DB, Rels>`, `QueryNamespace<DB>`, `TableQueryNamespace<DB, Table>`, `KickDbRelationsRegister`, `RegisteredRelations`, `RelationMapEntry`, `TableRelations<Table>`, `ResolvedRelation`, `ResolvedRelations`, `RelationSnapshot`.
  - Error classes: `RelationalQueryUnknownRelationError`, `RelationalQueryDepthError`, `RelationalQueryAliasCollisionError`, `RelationalQueryMissingInverseError`, `RelationalQueryNotSupportedError`. All extend `KickDbError` with stable codes (`KICK_DB_RELATIONAL_*`).

  **Type-level shape:** the registry pattern mirrors `KickDbRegister`. Adopters declare a single global augmentation (typegen plugin emits it) and the `with` clause auto-completes against declared relations:

  ```ts
  declare module '@forinda/kickjs-db' {
    interface KickDbRelationsRegister {
      db: {
        users: { posts: { kind: 'many'; target: 'posts' } }
        posts: {
   kind: 'one'; target: 'users' }
          comments: { kind: 'many'; target: 'comments' }
        }
      }
    }
  }
  ```

  **Tests:** 17 new tests across `extract-relations.test.ts` (8) and `query-builder.test.ts` (9) bring the db suite to 292 passing. db-pg suite remains green at 17.

  **Adopter migration:** none required for existing schemas — the new field is opt-in. Adopters who want to use `db.query.X` declare relations via `relations()` (already shipped in M2), augment `KickDbRelationsRegister`, and call the namespace.

- [#178](https://github.com/forinda/kick-js/pull/178) [`b98bcbe`](https://github.com/forinda/kick-js/commit/b98bcbe67ab3fd4bb33039831e3b87702a053919) Thanks [@forinda](https://github.com/forinda)! - Add the relational-query type surface and PostgreSQL compiler that back `db.query.X.findMany({ with })`. The runtime wire-up that exposes `db.query` on the client lands in a follow-up; this changeset ships the types, errors, and SQL emitter.

  **New types** (not yet re-exported from the public barrel — internal until the runtime wires up):
  - `FindManyOptions<Table>` — options bag for `findMany` / `findFirst` / `findUnique`. `where` / `orderBy` / `limit` / `offset` / `maxDepth` / `raw` / `with`. `with` keys are constrained to relations declared for the source table; nested `with` recurses with the same constraint.
  - `FindManyRow<Table, Opts>` — resolved row shape: base columns ∪ per-relation slot (`one` → `Related | null`, `many` → `Related[]`).
  - `KickDbRelationsRegister` — adopter-augmentable registry mirroring `KickDbRegister`. The kick/db typegen plugin will populate it alongside the column-shape augmentation.
  - `RelationMapEntry` / `RegisteredRelations` / `TableRelations` / `WithClause` / `QueryNamespace` / `TableQueryNamespace` — supporting types.

  **New PG compiler** at `packages/db/src/query/compile-pg.ts`:
  - Pure function `(db, table, options, relations, mode) → CompiledQuery`. No I/O.
  - Uses Kysely's `jsonArrayFrom` / `jsonObjectFrom` from `kysely/helpers/postgres` — produces `coalesce((select json_agg(agg) from ...) as agg, '[]')` for `many` and `(select to_json(obj) from ... limit 1) as obj` for `one`.
  - Recurses for nested `with` so deeply-nested relations compile to a single round-trip query.
  - Bridges the `(table, ops) => Expression` callback signature via a Proxy-backed table-ref so adopters write `(u, ops) => ops.eq(u.id, x)` idiomatically.
  - `mode: 'first' | 'unique'` clamps the outer query to `LIMIT 1`.

  **New error classes** at `packages/db/src/query/errors.ts`:
  - `RelationalQueryUnknownRelationError` — thrown at compile time when a `with` key isn't declared on the source table.
  - `RelationalQueryDepthError` — thrown when a `with` clause exceeds `maxDepth` (default 5; configurable per call).
  - `RelationalQueryAliasCollisionError` — thrown when a relation name shadows a column on the same table.
  - `RelationalQueryNotSupportedError` — thrown by SQLite/MySQL compiler stubs in v1.

  **New `ResolvedRelations` sidecar shape** at `packages/db/src/query/relations.ts`. Consumed by the compiler; populated by `extractSnapshot` in the follow-up. Tests construct literals directly so the SQL emitter is testable in isolation.

  **Tests:** 30 new tests in `packages/db/__tests__/unit/query-types.test.ts` (14 type cases) + `query-compile.test.ts` (16 SQL fixtures). Full db suite remains green at 275 tests.

  No public API surface changes in this release — adopters cannot reach these types from the package barrel yet. The minor bump reserves the version slot for the public surface that lands with the runtime wire-up next.

## 5.2.2

### Patch Changes

- [#166](https://github.com/forinda/kick-js/pull/166) [`a6d0dd6`](https://github.com/forinda/kick-js/commit/a6d0dd6038b215c0ae3cbe1a20e11ba0d8b1c46e) Thanks [@forinda](https://github.com/forinda)! - Minify published build output via the tsdown / oxc minifier.
  - **Library packages** use `minify: { compress: true, mangle: false }`. Whitespace and comments are stripped and constants folded, but identifiers stay intact so adopter stack traces remain readable.
  - **CLI** uses `minify: { compress: true, mangle: true }`. The CLI is an operator tool, not a library — full mangle is fine and gives a smaller binary.

  Net effect: roughly 30–40% smaller `dist/*.mjs` per package on disk, no public-API or behavior change.

## 5.2.1

### Patch Changes

- [#161](https://github.com/forinda/kick-js/pull/161) [`5de61d9`](https://github.com/forinda/kick-js/commit/5de61d9a9cd99bac3e1e271a36b092fa7bf7ad98) Thanks [@forinda](https://github.com/forinda)! - Documentation fixes:
  - README example now references the actual exported `SchemaToTypes<S>` helper (was `SchemaToKysely<S>`, which was never exported).
  - JSDoc examples in `adapter.ts` and `client/types.ts` updated to match the public surface.

  No runtime changes.
