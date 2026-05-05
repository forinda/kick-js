# @forinda/kickjs-db-sqlite

## 0.2.0

### Minor Changes

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

### Patch Changes

- Updated dependencies [[`8f9c153`](https://github.com/forinda/kick-js/commit/8f9c1533aa0d865b472f93fd02c174799d4767d8)]:
  - @forinda/kickjs-db@5.4.1
