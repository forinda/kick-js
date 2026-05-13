# @forinda/kickjs-db-pg

## 9.0.2

### Patch Changes

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

## 9.0.1

### Patch Changes

- [#207](https://github.com/forinda/kick-js/pull/207) [`df84283`](https://github.com/forinda/kick-js/commit/df8428364ad82cc14da2fd20b9b33f353a5a348c) Thanks [@forinda](https://github.com/forinda)! - chore(db-peers): use `workspace:^` instead of `workspace:*` for the `@forinda/kickjs-db` peer range — keeps minor core bumps from cascading to major peer bumps

  `workspace:*` was publishing as the **exact** core version (e.g. `5.6.0`). Every minor bump on `@forinda/kickjs-db` (e.g. `5.6 → 5.7`) made the peer's `peerDependencies` range string change too, which changesets-action correctly flagged as a peer-range change → escalated to a **major** bump on every peer adapter even when the peer's own source was unchanged. That's why the kysely 0.29 release shipped `db-pg@9.0.0` / `db-mysql@2.0.0` / `db-sqlite@2.0.0` from a minor changeset.

  `workspace:^` publishes as a caret range (e.g. `^5.6.0`), so the next `5.7.0` core release stays in-range — the peer's `peerDependencies` string doesn't change → no cascade. Only an actual major core bump (`6.0.0`) lands out of range and triggers the major-on-peers escalation, which is the correct semantic.

  Combined with the existing `___experimentalUnsafeOptions_WILL_CHANGE_IN_PATCH.onlyUpdatePeerDependentsWhenOutOfRange: true` config (which was already present but ineffective because `workspace:*` made every change "out of range"), future iterations stay on patch + minor unless an adapter's own source changes warrant otherwise.

## 9.0.0

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

### Patch Changes

- Updated dependencies [[`f9e24a5`](https://github.com/forinda/kick-js/commit/f9e24a591b1174f50deeec2567082f2194f77555)]:
  - @forinda/kickjs-db@5.6.0

## 8.0.0

### Patch Changes

- Updated dependencies [[`3dbdd06`](https://github.com/forinda/kick-js/commit/3dbdd06ba8dcf207d5bd4a5dc595c2d3e529182f)]:
  - @forinda/kickjs-db@5.5.0

## 7.0.1

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

- Updated dependencies [[`8f9c153`](https://github.com/forinda/kick-js/commit/8f9c1533aa0d865b472f93fd02c174799d4767d8)]:
  - @forinda/kickjs-db@5.4.1

## 7.0.0

### Patch Changes

- Updated dependencies [[`c601090`](https://github.com/forinda/kick-js/commit/c60109029a59694da9478dd714cb9aea684765fe), [`6be566a`](https://github.com/forinda/kick-js/commit/6be566a636fe1bbdd3c0b6b56d048f34c2c759e0), [`64ff558`](https://github.com/forinda/kick-js/commit/64ff558a2f1cee096f040a93b44d8eb68cd73255)]:
  - @forinda/kickjs-db@5.4.0

## 6.0.0

### Patch Changes

- Updated dependencies [[`45fd19d`](https://github.com/forinda/kick-js/commit/45fd19da8ad2856d1ac591b25a112098f9f642ca), [`efebe58`](https://github.com/forinda/kick-js/commit/efebe584147c2ed97c2741c49efe29164d2976d6), [`0a63cfc`](https://github.com/forinda/kick-js/commit/0a63cfc90cdc02c94dbdd410ac5f46d1952c3d06), [`b98bcbe`](https://github.com/forinda/kick-js/commit/b98bcbe67ab3fd4bb33039831e3b87702a053919)]:
  - @forinda/kickjs-db@5.3.0

## 5.2.2

### Patch Changes

- [#166](https://github.com/forinda/kick-js/pull/166) [`a6d0dd6`](https://github.com/forinda/kick-js/commit/a6d0dd6038b215c0ae3cbe1a20e11ba0d8b1c46e) Thanks [@forinda](https://github.com/forinda)! - Minify published build output via the tsdown / oxc minifier.
  - **Library packages** use `minify: { compress: true, mangle: false }`. Whitespace and comments are stripped and constants folded, but identifiers stay intact so adopter stack traces remain readable.
  - **CLI** uses `minify: { compress: true, mangle: true }`. The CLI is an operator tool, not a library — full mangle is fine and gives a smaller binary.

  Net effect: roughly 30–40% smaller `dist/*.mjs` per package on disk, no public-API or behavior change.

- Updated dependencies [[`a6d0dd6`](https://github.com/forinda/kick-js/commit/a6d0dd6038b215c0ae3cbe1a20e11ba0d8b1c46e)]:
  - @forinda/kickjs-db@5.2.2

## 5.2.1

### Patch Changes

- Updated dependencies [[`5de61d9`](https://github.com/forinda/kick-js/commit/5de61d9a9cd99bac3e1e271a36b092fa7bf7ad98)]:
  - @forinda/kickjs-db@5.2.1
