# @forinda/kickjs-db

## 8.3.0

### Minor Changes

- [#806](https://github.com/forinda/kick-js/pull/806) [`370b1b7`](https://github.com/forinda/kick-js/commit/370b1b7295310667384ba3b65f81cad59e3633c9) Thanks [@forinda](https://github.com/forinda)! - Run migrations with no migrations folder at run time: `migrationFiles(files, modules?)` takes the migration files bundled into the app (Vite's `import.meta.glob` with `?raw`), and goes wherever `migrationsDir` does — `kickDbAdapter()`, `migrateLatest()` and the rest. Review and hash checks work as for a folder; an array mixes bundled files and folders.

- [#808](https://github.com/forinda/kick-js/pull/808) [`c4cadbc`](https://github.com/forinda/kick-js/commit/c4cadbc2929f4f1694611ab753652b61f26b009c) Thanks [@forinda](https://github.com/forinda)! - `kick db push` (and `pushSchema()`): make a prototyping database match the schema with no migration file. Changes that lose data are asked about (`--accept-data-loss` to agree in advance), renames are asked or named with flags, and a change made to the database some other way since the last push stops it. Refused on a database with any migration applied, and whenever `NODE_ENV=production` — either one is enough.

### Patch Changes

- [#810](https://github.com/forinda/kick-js/pull/810) [`da45bbc`](https://github.com/forinda/kick-js/commit/da45bbc0c3fbd6894a1a67a4f5e9b72da80e9c2c) Thanks [@forinda](https://github.com/forinda)! - Seeds, the schema file and TypeScript migrations resolve the project's `tsconfig.json` path aliases (`@/db/client`), including in the app code they import. They failed with "Cannot find module '@/…'" before. Needs jiti 2.7, now the minimum.

## 8.2.0

### Minor Changes

- [#801](https://github.com/forinda/kick-js/pull/801) [`c7c67b5`](https://github.com/forinda/kick-js/commit/c7c67b561cb92259a40f78e56c7135cc02dbcef2) Thanks [@forinda](https://github.com/forinda)! - Re-export `sql`, `Kysely` and the query types (`Expression`, `ExpressionBuilder`, `KyselyPlugin`, `RawBuilder`, `Sql`, `SqlBool`) from `@forinda/kickjs-db`, so raw SQL and plugins need no import from `kysely`. The docs now import them from kick/db.

### Patch Changes

- [#804](https://github.com/forinda/kick-js/pull/804) [`95966aa`](https://github.com/forinda/kick-js/commit/95966aaa317c159a2de81e01872a91f8c8eb4440) Thanks [@forinda](https://github.com/forinda)! - `findOrCreate`'s `create` must now supply every required column that `where` leaves out. A seed or service that missed one (a column added since) compiled and then failed with `NOT NULL` at run time; it's a type error now.

- [#803](https://github.com/forinda/kick-js/pull/803) [`d874839`](https://github.com/forinda/kick-js/commit/d874839a4c0705160500297cafd154da3ae47451) Thanks [@forinda](https://github.com/forinda)! - TypeScript migrations (`migration.ts`) run when `migrationsDir` is relative, as `kick.config.ts` usually gives it (`'db/migrations'`). The file was looked up as a package name and failed with "Cannot find module".
- Updated dependencies [[`c7c67b5`](https://github.com/forinda/kick-js/commit/c7c67b561cb92259a40f78e56c7135cc02dbcef2)]:
  - @forinda/kickjs-cli-kit@0.1.3

## 8.1.0

### Minor Changes

- [#786](https://github.com/forinda/kick-js/pull/786) [`46d0906`](https://github.com/forinda/kick-js/commit/46d09064782742c85c4e82f52823ddd56677f299) Thanks [@forinda](https://github.com/forinda)! - `casing: 'snake_case'`: camelCase keys in TypeScript over snake_case tables and columns. Set it on `createDbClient` and in `kick.config.ts` `db`.
  
  - **Migrations:** they name tables, columns, keys and foreign keys in snake_case, and re-derive kick/db's own constraint names. Names you wrote are kept.
  - **Queries:** they convert both ways through Kysely's `CamelCasePlugin`. It is split around kick/db's plugins so managed columns, codecs and date decoding still work by key, including nested `db.query` rows.
  - **Elsewhere:** `createTestDb` / `createPgTestDb` take `casing`, `kick db introspect` renders camelCase keys when it's set, and `extractSnapshot(schema, dialect, { casing })` exposes it programmatically.

- [#779](https://github.com/forinda/kick-js/pull/779) [`bee0dbf`](https://github.com/forinda/kick-js/commit/bee0dbfdd5380cc84f2335ce0c95ea73b922083f) Thanks [@forinda](https://github.com/forinda)! - Two commands for running migrations in CI and production:
  
  - `kick db check` fails (exit 1) when the schema has changes no migration covers, a migration isn't reviewed, or a reviewed migration was edited after review — everything `migrate latest` would refuse, found without a database, so CI catches it before a deploy does. Also exported as `checkMigrations({ config, cwd })`.
  - `kick db migrate unlock` releases the migration lock a run left behind when it was killed mid-migration. Until now that needed a hand-written `UPDATE` on the lock table; the "another process holds the migration lock" error now says to use it.

- [#792](https://github.com/forinda/kick-js/pull/792) [`20d0bf8`](https://github.com/forinda/kick-js/commit/20d0bf8d4f9f58a77ed3a41147157c175a7be117) Thanks [@forinda](https://github.com/forinda)! - More column options (D.24).
  
  - **JS-side defaults:**
    - `.$defaultFn(fn)` fills a column per inserted row that leaves it out, including the rows of a multi-row insert.
    - `.$onUpdate(fn)` sets it on every update and every upsert update branch that doesn't set it.
  - **`mode` for big and exact numbers:** `bigint({ mode: 'bigint' | 'number' | 'string' })` and `numeric(p, s, { mode: 'number' | 'string' })`.
    - The value is read back as that type, top level and in `db.query` nested rows, and validators follow.
    - Without `mode`, nothing changes.
  - **Comments:** `.comment(text)` on columns, and `table(name, columns, { comment, constraints })` for tables.
    - Postgres: migrated with `COMMENT ON`. MySQL: inline, or by restating the column, keeping `AUTO_INCREMENT` on a serial key.
    - Read back by introspection and `kick db introspect`. SQLite ignores them.
    - MySQL column definitions now always carry their comment, so a column alter no longer erases it.
  - **Postgres:** `halfvec(n)`, `point()` (`{ x, y }`), `geometry(type?, srid?)`, `macaddr()` and `macaddr8()`.
    - Fix: `vector(n)` now reads and writes `number[]`. It used to return the text `'[1,2,3]'` and send arrays as Postgres array literals.
  - **MySQL:** `mysqlEnum(...values)` (typed union; values keep their case through emit, introspection and validators), `unsigned(col)`, `tinyint()`, `mediumint()` and `datetime(fsp?)`.

- [#784](https://github.com/forinda/kick-js/pull/784) [`ddea862`](https://github.com/forinda/kick-js/commit/ddea862229d168e524c931d4f1edc9f00cade38d) Thanks [@forinda](https://github.com/forinda)! - `columns` and `extras` in relational reads, at every level of `with`.
  
  - **`columns`:** `{ id: true, title: true }` returns only those columns, and `{ passwordHash: false }` returns everything else.
  - **`extras`:** `{ postCount: (_u, eb) => … }` adds computed fields from SQL expressions.
  
  The row type follows both: excluded columns disappear, and each extra is typed from its expression. A mix of `true` and `false`, or an unknown column, is refused. `findManyAndCount` counts the same rows.

- [#792](https://github.com/forinda/kick-js/pull/792) [`709bf15`](https://github.com/forinda/kick-js/commit/709bf1519c6fc1b0baf3684e4715061b1c131ed8) Thanks [@forinda](https://github.com/forinda)! - Runs on edge and serverless drivers (D.23).
  
  - **`createDbClient({ dialectTag })`:** names the SQL a dialect speaks.
    - Raw Kysely dialects (Neon, D1, libsql, PlanetScale) are still recognised by their adapter.
    - A dialect kick/db can't place now throws and asks for `dialectTag`. Before, it was treated as SQLite and failed at the first query.
  - **`asyncSqliteAdapter({ driver })`:** migrations on async SQLite drivers, with `libsqlDriver(client)` for libsql/Turso and `d1Driver(db)` for Cloudflare D1.
    - Each migration is one atomic batch, with its bookkeeping row and, after a table rebuild, a foreign-key check.
    - `introspect()` works over the driver.
    - Passing `kysely` enables TypeScript migrations.
  - **`introspectSqliteAsync(query)`:** SQLite introspection over any async driver.
  - **`bun:sqlite`:** `sqliteDialect` now returns rows on Bun. Kysely's driver read a better-sqlite3-only field, so every SELECT ran as a write and returned nothing.
  - **`generate()` and `check()`:** they reload the schema file, so a second call in the same process sees your edits.

- [#783](https://github.com/forinda/kick-js/pull/783) [`42bc32e`](https://github.com/forinda/kick-js/commit/42bc32e3f5621adcd4ad7bc73e5567809ab7a94e) Thanks [@forinda](https://github.com/forinda)! - `db.query.X.findManyAndCount(options)` returns one page and the total number of rows `where` matches before `limit` / `offset`, as `{ data, total }` — the shape `ctx.paginate` takes. The count runs as a second query with the same `where` and soft-delete filter, ignoring `with`, `orderBy` and paging; `total` is always a number, including on Postgres.

- [#784](https://github.com/forinda/kick-js/pull/784) [`c494efd`](https://github.com/forinda/kick-js/commit/c494efdacfc7043cdfe61e355ee23d1f54c0fcf5) Thanks [@forinda](https://github.com/forinda)! - Generated and identity columns.
  
  - **`.generatedAlwaysAs(sql, { stored? })`:** a column the database computes from the row. Stored by default; virtual on MySQL, SQLite and Postgres 18+.
  - **`.generatedAlwaysAsIdentity()` / `.generatedByDefaultAsIdentity()`:** identity columns, Postgres only.
  
  Generated columns and `ALWAYS` identities type as Kysely's `GeneratedAlways<T>`, so writes are rejected at compile time. `InferInsert`, `insertSchema` and `updateSchema` leave them out.
  
  Migrations change them in place where the database allows: Postgres `SET EXPRESSION` / `DROP EXPRESSION` and `ADD | SET | DROP IDENTITY`, MySQL `MODIFY`, and a SQLite rebuild, which also adds stored generated columns. Introspection reads them back on Postgres and SQLite.
  
  Also fixed: a SQLite table rebuild no longer copies into a generated column, which SQLite refuses.

- [#781](https://github.com/forinda/kick-js/pull/781) [`de72ad2`](https://github.com/forinda/kick-js/commit/de72ad2709821b0a8d7bfc93ac8fe29d5d555b4a) Thanks [@forinda](https://github.com/forinda)! - Columns kick/db maintains (D.10), declared in the schema — no migration involved:
  
  - `.onUpdateNow()` sets a timestamp to the current time on every update that doesn't set it itself, including an upsert's update branch.
  - `version()` — an integer, not null, starting at 0 — is incremented on every update; guard an update with `.where('version', '=', read)` for optimistic locking.
  - `.softDelete()` marks a nullable timestamp as the deleted flag: relational reads (`db.query`) skip rows where it's set, at every level, unless asked `withDeleted: true`.
  
  They apply to queries kick/db builds; raw SQL and the plain query builder's reads are untouched.
  
  Tables in a named Postgres schema (`pgSchema('billing').table(…)`) get them too — and `db.query` on such a table no longer builds an alias (`billing.invoices_0`) that a column reference read as a schema.

- [#781](https://github.com/forinda/kick-js/pull/781) [`5a015d0`](https://github.com/forinda/kick-js/commit/5a015d000c245380cc351820a289276c51d2770c) Thanks [@forinda](https://github.com/forinda)! - Many-to-many in relational reads: `many(tags, { through: postTags })` loads a post's tags through the junction table in the same single query, with `where`, `orderBy`, `limit` and nested `with` like any `many`. The junction's foreign keys decide the join; when it has more than one to a side — a table joined to itself, like `follows` — name them: `{ table: follows, from: [follows.followerId], to: [follows.followeeId] }`. A junction that can't be resolved throws `RelationalQueryThroughError` at client creation.

- [#786](https://github.com/forinda/kick-js/pull/786) [`af587f9`](https://github.com/forinda/kick-js/commit/af587f93a5aca507d474907664c372c15f1bd912) Thanks [@forinda](https://github.com/forinda)! - Migration and transaction options.
  
  - **`db.transaction({ readOnly: true }, fn)`:** a read-only transaction (Postgres, MySQL), refused on SQLite.
  - **`kick db migrate up --to <migration>` / `migrateUp({ to })`:** applies through a named migration.
  - **`migrate down --to <migration>` / `migrateDown({ to })`:** reverses everything after it. `migrateDown` now also returns `reversedAll`.
  - **`migrate rollback --all` / `migrateRollback({ all: true })`:** reverses every migration.
  - **`migrationsTable`:** in the `db` config or on `pgAdapter` / `mysqlAdapter` / `sqliteAdapter`, it renames the bookkeeping tables. On Postgres it may be schema-qualified. Those tables are left out of introspection and drift.
  - **`migrationsDirs` / `migrationsDir: [...]`:** runs several migration folders as one history ordered by id, with drift checked across them.
  
  Also fixed: `kick db` now reads `casing` from the `db` config block. The config resolver used to drop it.

- [#784](https://github.com/forinda/kick-js/pull/784) [`6972cee`](https://github.com/forinda/kick-js/commit/6972cee27045346f45792057da68f012c969d1ed) Thanks [@forinda](https://github.com/forinda)! - Condition helpers, table aliases and reusable CTEs.
  
  - **Operators:** `eq`, `ne`, `gt`, `gte`, `lt`, `lte`, `like`, `notLike`, `ilike`, `isNull`, `isNotNull`, `inArray`, `notInArray`, `between`, `and`, `or`, `not`, `exists`, `notExists`.
    - Exported from `@forinda/kickjs-db`, and they return Kysely expressions, so they work in `.where()`, join `.on()`, `having`, and `db.query`'s `where`.
    - Operands are type-checked against the column. They can be a table's columns, the `db.query` row argument, any Kysely expression, or a value.
    - Edge cases stay valid SQL: `and()` / `or()` skip `undefined`, and empty `inArray` lists are handled.
  - **`alias(table, name)`:** the same table under another name, for self-joins, with `$from` for `selectFrom` and joins.
  - **CTEs:** `db.with`, `db.withRecursive` and `db.cte(name, query)` are now on the client, so a CTE can be defined once and spread in: `db.with(...recent)`.

- [#773](https://github.com/forinda/kick-js/pull/773) [`4d04049`](https://github.com/forinda/kick-js/commit/4d04049d4d9a14d10e2b4a25b052e025107b2b5f) Thanks [@forinda](https://github.com/forinda)! - Primary-key and CHECK changes in migrations.
  
  - **Composite and named keys:** `primaryKey(name?).on(t.a, t.b)` in a table's constraints declares a key over several columns, in key order, optionally named (Postgres keeps the name). Declaring a key both this way and with a column's `.primaryKey()` throws.
  - **CHECK constraints:** `check(name, expression)` in the constraints. They're created with the table and migrated when added, removed or changed.
  - **Key changes migrate:** a changed primary key used to surface only as a column change — Postgres emitted nothing for the key and MySQL a `MODIFY COLUMN` that neither added nor dropped it. It's now its own change: Postgres drops the old constraint before columns are dropped and adds the new one after columns are added; MySQL swaps the key in one statement; SQLite rebuilds the table. Down migrations reverse it.
  - **SQLite rebuilds check foreign keys:** a migration that rebuilds a table runs `PRAGMA foreign_key_check` before committing and rolls back if a row points at a missing parent.
  - Snapshots of tables without these are unchanged, so existing migration hashes stay valid.

- [#781](https://github.com/forinda/kick-js/pull/781) [`1425728`](https://github.com/forinda/kick-js/commit/1425728a6b3bd7c68e6a957b814ecfc3d096fcd9) Thanks [@forinda](https://github.com/forinda)! - Read replicas: `createDbClient({ schema, dialect, replica })` — a dialect, or several used in turn. Reads outside a transaction (`selectFrom`, `db.query`) go to a replica; writes, raw `db.qb`, and everything inside a transaction go to the primary. `db.primary` is the same client with reads pinned to the primary, for reading your own writes while replicas lag; `findOrCreate()` and `upsert()`'s MySQL read-back already use it. `db.destroy()` closes the replicas too.

- [#778](https://github.com/forinda/kick-js/pull/778) [`8d200b7`](https://github.com/forinda/kick-js/commit/8d200b7af7ce62e99aa9cd0b1e0cac3178c56e42) Thanks [@forinda](https://github.com/forinda)! - Relational queries can sort descending: `asc()` and `desc()` wrap an `orderBy` expression — `orderBy: (_p, eb) => desc(eb.ref('publishedAt'))` — at the top level and inside `with`, on every dialect. Returning an array from `orderBy` (`[desc(eb.ref('priority')), asc(eb.ref('title'))]`), which the type always allowed, now works; it used to throw. An empty array sorts nothing. The relational-query guide's per-relation example used `eb.isNotNull()` and `.desc()`, which don't exist; it now uses `eb('publishedAt', 'is not', null)` and `desc()`.

- [#784](https://github.com/forinda/kick-js/pull/784) [`ffb217e`](https://github.com/forinda/kick-js/commit/ffb217e5e04e45ec12e208defcc6590e59ec7da2) Thanks [@forinda](https://github.com/forinda)! - `kick db generate` asks which drops are renames. When a table or column is dropped and a new one could replace it, a terminal run asks "Column people.fullName is gone. Was it renamed?". Tables are asked about first, then columns, including those inside a renamed table. A rename that also changes the type is a rename plus an alter, so rows keep their values.
  
  Outside a terminal, name renames with `--rename-table old=new` / `--rename-column table.old=new`. Any other drop that could be a rename prints a warning with the flag that would keep it.
  
  Programmatically, `generate({ renames, askRenames, onPossibleRename })` and `diff(prev, next, { renames })` do the same, and `findRenameCandidates()` lists the possible renames.
  
  Also fixed: a SQLite table rebuild in the same migration as a table or column rename copied from the wrong names and failed.

- [#784](https://github.com/forinda/kick-js/pull/784) [`227c394`](https://github.com/forinda/kick-js/commit/227c3948e7d7a853f4c51ea4c210a7e3d7133b3d) Thanks [@forinda](https://github.com/forinda)! - Richer indexes. Chain options onto `index(…).on(…)` / `unique(…).on(…)`:
  
  - `.where(sql)` makes a partial index (Postgres, SQLite).
  - A string key is an expression: `.on('lower(email)')` (all three dialects).
  - `.using('gin' | 'gist' | 'hnsw' | …)` sets the index method (Postgres; MySQL takes `btree` / `hash`).
  - `.op(key, 'gin_trgm_ops')` sets an operator class (Postgres).
  - `.include(...cols)` adds covering columns (Postgres).
  - `.concurrently()` (Postgres): `kick db generate` writes each concurrent index change as a migration of its own that runs outside a transaction.
  
  An option the dialect can't express fails when the schema is read. Introspection reads expressions, predicates, methods and `INCLUDE` back on Postgres, and predicates on SQLite.
  
  Behaviour change: an index whose definition changed under the same name is now dropped and recreated by `generate`. Before, the diff compared indexes by name only and missed the change. Drift checks still compare name, uniqueness and plain columns.

- [#792](https://github.com/forinda/kick-js/pull/792) [`f8ed04f`](https://github.com/forinda/kick-js/commit/f8ed04f57f844ae0cdf569085d4e7707f514bd14) Thanks [@forinda](https://github.com/forinda)! - Row-level security in the schema (D.26, Postgres).
  
  - **Declaring:** `policy(name).for(...).to(...).as(...).using(sql).withCheck(sql)` in a table's constraints. `table(name, columns, { rls: true | { force: true } })` turns RLS on, which a policy also does.
  - **Roles:** `pgRole(name, { login, createDb, createRole, inherit, bypassRls })` is created by migrations if missing. A role is never dropped, not even by a down migration. `pgRole(name).existing()` refers to one managed elsewhere.
  - **Migrations:**
    - Roles come first, policy drops before the table changes, and RLS switches and policy creates last.
    - A changed policy is dropped and re-created.
    - Policies on a table whose shape changes, or whose SQL names such a table, are dropped and re-created around the change.
  - **`db.transaction({ settings, role }, fn)`:** `set_config(key, value, true)` and `SET LOCAL ROLE`, scoped to the transaction so they're safe on a pool. They're refused inside an open transaction unless `nested: 'separate'`.
  - **Introspection** reads RLS state and policies, and `kick db introspect` renders them. Drift compares policies by name, command, kind and roles, and ignores declared roles.

- [#781](https://github.com/forinda/kick-js/pull/781) [`b2dcfdb`](https://github.com/forinda/kick-js/commit/b2dcfdb76b63af084511ab377e72afd4a43bc481) Thanks [@forinda](https://github.com/forinda)! - `kick db seed [names...]` runs the seed files in `db/seeds` (`seedsDir` in the `db` config) in name order, or only the ones named. Each file default-exports an async function and imports what it needs — usually the app's own client — and nothing records that it ran, so seeds are written to be re-run (`db.upsert()` / `db.findOrCreate()`). A failing seed stops the run with `Seed <file> failed: …` and exit code 1. Also exported as `runSeeds()` / `listSeeds()`.
  
  Schema files, seed files and `kick db check` now load through jiti, like `kick.config.ts`: a schema split across files with extensionless relative imports used to fail under Node's built-in TypeScript loading.
  
  Seed files that share a name (`01_users.ts` beside `01_users.js`) are refused before any runs, a seed that fails to load is named in the error, and JavaScript seeds get extensionless relative imports too.

- [#792](https://github.com/forinda/kick-js/pull/792) [`fa0f2ac`](https://github.com/forinda/kick-js/commit/fa0f2ac9b6392a05d889a30790892ee9ef4b8851) Thanks [@forinda](https://github.com/forinda)! - Tenancy, continued.
  
  - **Jobs:** tenancy registers as a kickjs job context carrier, so a job dispatched as a tenant runs as that tenant. Needs `@forinda/kickjs` 8.8 for `registerJobContext`; the peer range is now `>=8.8.0`.
  - **`'database'` connections:** a tenant's connections close after `tenantIdleMs` unused (default 10 minutes). `maxOpenTenants` caps how many tenants keep connections open, closing the least recently used idle one; tenants with a query in flight are never closed.
  - **`'rls'` with `'transaction'` binding:** a lone query is three round trips instead of four, because `BEGIN` and the tenant now go in one simple query, with the tenant quoted as a SQL literal. Costs are measured on the Tenancy page.

- [#792](https://github.com/forinda/kick-js/pull/792) [`c840d9c`](https://github.com/forinda/kick-js/commit/c840d9c18011f7a1cb388baa6ec23552e04ac737) Thanks [@forinda](https://github.com/forinda)! - Multi-tenancy: `defineTenancy({ strategy })` with `'column'`, `'rls'`, `'schema'` or `'database'`, given to both the schema and the client, so handlers and repositories carry no tenant code.
  
  - **`tenantKey(tenancy)`** marks a tenanted table.
    - `'column'` adds the tenant to every select, update and delete on it (joins in their `ON`, every level of `db.query`), and fills or refuses it on insert.
    - `'rls'` generates a forced row-level-security policy, and fills the tenant on insert.
  - **`'rls'` binding:** `'transaction'` (default) sets the tenant locally per transaction, which is safe behind PgBouncer-style poolers. `'connection'` sets it once per connection, for pools the app owns.
  - **`'schema'`** points each query at the tenant's schema. **`'database'`** routes each tenant to its own database via `dialectFor(id)`, with drivers cached per tenant.
  - **The current tenant** defaults to the request's `tenant` value. `tenancy.run(id, fn)` covers jobs, cron, scripts and tests. With no tenant, queries fail closed.
  - **`tenancy.bypass(fn, { reason, allowInRequest })`:**
    - a reason is required, and each call goes to the `onBypass` audit hook;
    - it's refused inside a request by default;
    - under `'rls'` it runs on a separate `bypassDialect` (a `BYPASSRLS` role), tagged `application_name = kick-bypass`.
  - **`roleCheck`:** under `'rls'`, the client refuses to run as a superuser or `BYPASSRLS` role.
  - **`migrateTenants({ tenants, adapterFor })`** and `kick db migrate latest --tenants` (`db.tenants` in `kick.config`) migrate every tenant's schema or database and report failures per tenant.

- [#781](https://github.com/forinda/kick-js/pull/781) [`8e98bef`](https://github.com/forinda/kick-js/commit/8e98bef8a358c6915c96f2febd89e3e81765d682) Thanks [@forinda](https://github.com/forinda)! - Test helpers, from `@forinda/kickjs-db/testing`:
  
  - `createTestDb({ schema })` — an in-memory SQLite database with the schema (or `migrationsDir`'s migrations) applied and foreign keys on; one per test file, milliseconds to create.
  - `createPgTestDb({ schema, connectionString })` — a throwaway database on an existing Postgres server (a CI service container, local Docker), with the schema or migrations applied; `drop()` removes it. No container per test file.
  - `rolledBack(db, fn)` — runs a test in a transaction that's always rolled back; code holding only the client joins it through the call chain.

- [#772](https://github.com/forinda/kick-js/pull/772) [`07e6ec2`](https://github.com/forinda/kick-js/commit/07e6ec2aa48620f23162ee4bcc0f165f8a35e8fa) Thanks [@forinda](https://github.com/forinda)! - Transactions that follow the call chain, `afterCommit`, and retry.
  
  - **Call-chain transactions:** inside `transaction(fn)`, the plain client joins the transaction — repositories using the injected `db` take part without being handed `tx`. Concurrent requests each keep their own. `db.inTransaction` reports whether one is open.
  - **Nesting:** `transaction({ nested })` — `'reuse'` (default) runs inside the open transaction, `'savepoint'` behind a savepoint, `'separate'` in an independent transaction on another connection (not on SQLite). Before, a nested `db.transaction()` always opened a separate one.
  - **`afterCommit(fn)`:** runs once the transaction commits, dropped on rollback (including a rolled-back savepoint); runs at once outside a transaction. A failing hook is reported, not thrown.
  - **`retry`:** `transaction({ retry: true })` runs the whole transaction again on a serialization failure or deadlock (`err.retryable`), with jittered exponential backoff; a `transactionRetry` event fires per retry.
  - `savepoint()` on the plain client now opens the savepoint on the call chain's transaction, and throws a clear error outside one.

- [#785](https://github.com/forinda/kick-js/pull/785) [`44472a6`](https://github.com/forinda/kick-js/commit/44472a6771a06a3114e525fad0adc3b4c5ccf8bf) Thanks [@forinda](https://github.com/forinda)! - Migrations written in TypeScript. `kick db generate <name> --ts` (or `generate({ typescript: true })`) writes a `migration.ts` exporting `up(db)` / `down(db)`, for data changes that need code.
  
  - **Runs:** `db` is Kysely on the migration's transaction, and the migration is recorded on the same transaction, so a failure leaves neither its changes nor its record. With `"transaction": false` it runs on the connection.
  - **Hashing:** the code is hashed with the migration, so an edit after review is refused. SQL migrations keep their existing hashes.
  - **Adapters:** migration adapters gain an optional `kysely()`, which the Postgres, MySQL and SQLite adapters implement.
  - **Loading:** migration code is read fresh on every run, never from a module cache.

- [#772](https://github.com/forinda/kick-js/pull/772) [`9fc8ceb`](https://github.com/forinda/kick-js/commit/9fc8ceb8826a328fbe582382264192896a071129) Thanks [@forinda](https://github.com/forinda)! - Typed database errors.
  
  A failed query now throws `UniqueViolationError`, `ForeignKeyViolationError`, `CheckViolationError`, `NotNullViolationError`, `SerializationFailureError`, `DeadlockError`, `ConnectionError` or the `DatabaseError` base instead of the driver's own error — on Postgres, MySQL and SQLite, for queries, transactions (including a serializable `COMMIT`), savepoints and connecting. Each carries the `constraint`, `table`, `columns` and `detail` the database reported, `driverCode`, and the driver's error as `cause`. Serialization failures and deadlocks are `retryable`. A `UniqueViolationError` has `status: 409`, so an unhandled one answers `409` rather than `500`.
  
  Code that caught driver errors by their own class or `code` should read `err.cause` (or switch to the typed classes).

- [#781](https://github.com/forinda/kick-js/pull/781) [`b4380f2`](https://github.com/forinda/kick-js/commit/b4380f230d796e823968c2b94006ae9895b8b803) Thanks [@forinda](https://github.com/forinda)! - `db.upsert()` and `db.findOrCreate()`.
  
  - `db.upsert(table, { values, target, update?, where? })` inserts a row — or rows — or updates the ones whose `target` key exists, in one statement, and returns them as stored: `ON CONFLICT … DO UPDATE … RETURNING` on Postgres and SQLite, `ON DUPLICATE KEY UPDATE` plus a read-back on MySQL. `update` takes column names (default: every inserted column outside `target`) or values and expressions; `where` targets a partial unique index.
  - `db.findOrCreate(table, { where, create? })` returns `{ row, created }`. It's race-safe: a request that loses the race to insert catches the `UniqueViolationError` and reads the winner's row, and inside a transaction the insert runs in a savepoint so losing doesn't abort the transaction on Postgres.

- [#792](https://github.com/forinda/kick-js/pull/792) [`5f374d2`](https://github.com/forinda/kick-js/commit/5f374d23fddf66e8cb5f3c82441d591f80c5b0de) Thanks [@forinda](https://github.com/forinda)! - Views and materialized views (D.25).
  
  - **Declaring:** `view(name, columns, { as })` from the root, and `materializedView(name, columns, { as, constraints })` from `@forinda/kickjs-db/pg`. They're queried through the typed client like tables.
  - **Migrations:**
    - Views are created after the tables in declaration order, and dropped before them.
    - A changed definition drops and re-creates the view.
    - A view whose SQL names a table the migration alters, and any view over such a view, is dropped and re-created around the change. Postgres won't alter a column a view uses, and SQLite's table rebuild breaks a view over the table.
    - SQLite creates views after its table rebuilds.
  - **Materialized views:** indexes, and `db.refreshMaterializedView(name, { concurrently })`.
  - **Introspection** reads views on Postgres, MySQL and SQLite, with columns and materialized-view indexes. `kick db introspect` renders them, and drift compares which views exist.
  - Snapshots without views are unchanged.

### Patch Changes

- [#777](https://github.com/forinda/kick-js/pull/777) [`e63bdf9`](https://github.com/forinda/kick-js/commit/e63bdf97eff6c8c020cdcdf5a5dbd858b53594d8) Thanks [@forinda](https://github.com/forinda)! - `insertSchema` / `updateSchema` / `selectSchema` hold a `decimal(p, s)` / `numeric(p, s)` column to its precision and scale: `decimal(12, 2)` accepts at most 10 digits before the point and 2 after. A third decimal place used to pass validation and be rounded away by the database, and an oversized value failed the insert with a server error; both are now `422` validation issues naming the column. The OpenAPI `pattern` reflects the same bounds. A scale outside 0…precision (Postgres' `numeric(3, 5)`, `numeric(2, -3)`) keeps the plain decimal check and leaves the range to the database.

- [#779](https://github.com/forinda/kick-js/pull/779) [`464710c`](https://github.com/forinda/kick-js/commit/464710cdc1b93a7ecb95f0be38d0e56b203462fe) Thanks [@forinda](https://github.com/forinda)! - Migration errors say what went wrong. A migration whose SQL fails throws `MigrationFailedError` — "Migration <id> failed: <the database's message>", with `id` and the driver error as `cause` — instead of the bare driver error, which didn't say which of several pending migrations broke. "Schema drift detected" now lists what drifted — `(added: users.bio)` — not only the counts.

- [#778](https://github.com/forinda/kick-js/pull/778) [`8d6a40c`](https://github.com/forinda/kick-js/commit/8d6a40ce66284b3b18d535b5df0a35038d12835d) Thanks [@forinda](https://github.com/forinda)! - MySQL works as documented, end to end:
  
  - `mysqlDialect({ pool })` with a `mysql2/promise` pool — the same pool `mysqlAdapter` takes — no longer hangs on every query. Kysely drives mysql2's callback API, which a promise pool ignores; the dialect now hands Kysely the pool's callback core.
  - A real mysql2 `Pool` satisfies `MysqlPoolLike` without a cast (its query values are mutable; the type said `readonly`).
  - After a migration with a foreign key on a column with no index of its own, the next `migrate latest` no longer fails with "Schema drift detected": the non-unique index InnoDB creates for the foreign key isn't counted as drift (a unique index is still compared).
  - `mysqlAdapter` and `pgAdapter` take `endPoolOnClose: true` for a pool the adapter owns — a `kick.config.ts` `db.adapter()` factory that opens one for the CLI — so `kick db` exits when it's done instead of waiting on the open pool. A pool with no `end()` is refused up front (`KICK_DB_POOL_NOT_CLOSABLE`) rather than silently left open.
  
  Rows nested by `db.query` decode their dates on Postgres and MySQL too, as they already did on SQLite: `timestamp`, `timestamptz` and `date` columns come back as `Date`, read the way the driver reads the same column at the top level (on MySQL, in the pool's `timezone`, and left as strings for the types mysql2's `dateStrings` keeps as strings).

- [#777](https://github.com/forinda/kick-js/pull/777) [`d717834`](https://github.com/forinda/kick-js/commit/d717834263c718daf18f07c2410497d4a57f6847) Thanks [@forinda](https://github.com/forinda)! - Rows that `db.query` nests under a relation now decode like top-level rows: a `customType` column comes back through its `fromDriver` codec on every dialect (a JSON-text list used to arrive as the raw string), and on SQLite nested dates are `Date` and nested decimals are exact strings. An ordinary column that shares a relation's name keeps its stored value.

- [#780](https://github.com/forinda/kick-js/pull/780) [`edfcf63`](https://github.com/forinda/kick-js/commit/edfcf634182d58961fdac7dc9476976e86cbd311) Thanks [@forinda](https://github.com/forinda)! - A migration and its `kick_migrations` row commit in one transaction. The row used to be written after the migration's transaction committed, so a crash in between left the migration applied but unrecorded, and the next run failed re-applying it; `migrate down` had the mirror problem. The built-in Postgres, MySQL and SQLite adapters implement a new optional `MigrationAdapter.applyMigrationInTx(sql, bookkeeping)`; a custom adapter without it keeps the old two-step behaviour. The window remains where a transaction can't cover it: a migration with `transaction: false`, and on MySQL any migration with DDL, which MySQL commits as it runs.

- [#784](https://github.com/forinda/kick-js/pull/784) [`cf9455b`](https://github.com/forinda/kick-js/commit/cf9455b0a1f3c5af15b03621fabda538584b2762) Thanks [@forinda](https://github.com/forinda)! - `$extends({ result })` computeds now apply to related rows that `db.query` loads through `with`, at every level. The types already promised them, but they were missing at runtime.

- [#779](https://github.com/forinda/kick-js/pull/779) [`5bbab4a`](https://github.com/forinda/kick-js/commit/5bbab4a4cbaef78b05f76c1ee77daa1ed9f6a675) Thanks [@forinda](https://github.com/forinda)! - Hand-written SQL in a migration applies. The journal hash was recorded at `generate` and never again, so filling in a `kick db generate <name> --empty` migration — which its own output tells you to do — or editing a generated one before review failed `migrate latest` with "Hash mismatch", reviewed or not. `kick db migrate review <id>` now records the hash of the files as reviewed, and the runner checks the hash only for reviewed migrations: an edit after review is still refused, until you review it again. An unreviewed migration applied in development is recorded with its current hash.

- [#778](https://github.com/forinda/kick-js/pull/778) [`2e70fe5`](https://github.com/forinda/kick-js/commit/2e70fe555b41919dbd2cf94463fd9965589b9345) Thanks [@forinda](https://github.com/forinda)! - Booleans work on SQLite. A `boolean()` column is typed `boolean`, but writing `true` failed ("SQLite3 can only bind numbers, strings, bigints, buffers, and null") and reads came back as `1` / `0`. Booleans now bind as `1` / `0` anywhere — values, `where`, raw `sql` — and `boolean()` columns read back as `true` / `false` — any non-zero integer as `true`, as SQLite reads it.

- [#777](https://github.com/forinda/kick-js/pull/777) [`7112eaa`](https://github.com/forinda/kick-js/commit/7112eaa0acb15e0f4203b0f26d63a79f7e7f3cb3) Thanks [@forinda](https://github.com/forinda)! - Dates work on SQLite. `timestamp()`, `timestamptz()` and `date()` columns are typed `Date`, but on SQLite they read back as strings and writing a `Date` failed ("SQLite3 can only bind numbers, strings, bigints, buffers, and null"). They now read back as `Date`, and a `Date` is accepted anywhere — insert and update values, `where` clauses, raw `sql` — stored as `YYYY-MM-DD HH:MM:SS.SSS` in UTC (the shape SQLite's own `CURRENT_TIMESTAMP` writes, so old and new values sort together); `date()` columns store `YYYY-MM-DD`, and a `Date` compared with a `date()` column in a `where` (`=`, `<`, `in`, …) matches by calendar day. A `customType` codec on a column still takes precedence.

- [#777](https://github.com/forinda/kick-js/pull/777) [`047970f`](https://github.com/forinda/kick-js/commit/047970fe0378df14694cd3389575a2d29fb114be) Thanks [@forinda](https://github.com/forinda)! - `decimal()`, `numeric()` and `money()` columns on SQLite now read back as strings at the column's scale — `decimal(12, 2)` gives `'0.10'`, as on Postgres and MySQL — instead of the float `0.1` that contradicted their `string` type. SQLite still stores a float, so values are exact up to 15 significant digits.

- [#777](https://github.com/forinda/kick-js/pull/777) [`fad73c9`](https://github.com/forinda/kick-js/commit/fad73c95b5cb6a22d68987c400bcf3b3762a7dd8) Thanks [@forinda](https://github.com/forinda)! - `defaultNow()` on SQLite stores milliseconds — `strftime('%Y-%m-%d %H:%M:%f', 'now')` instead of `CURRENT_TIMESTAMP`, which has whole seconds — so rows inserted within the same second no longer tie on `ORDER BY createdAt`. The stored shape matches what kick/db writes for a `Date`. Applies to tables created or rebuilt from now on; drift checks ignore SQLite defaults.

- [#779](https://github.com/forinda/kick-js/pull/779) [`f8afde6`](https://github.com/forinda/kick-js/commit/f8afde6933eb01d27dc1496c3e4ff0b3977b14f3) Thanks [@forinda](https://github.com/forinda)! - Two SQLite fixes:
  
  - A table keyed by `serial()` no longer reads as drift on every `migrate latest` after the first ("Schema drift detected: 0 added, 0 removed, 1 changed"). SQLite reports an inline `INTEGER PRIMARY KEY` as nullable; drift now treats every primary-key column as not null.
  - `json()`, `jsonb()` and `.array()` columns work: values are stored as JSON text and read back as what was written, at the top level and in nested `db.query` rows. Writing an object or array used to throw "SQLite3 can only bind numbers, strings, bigints, buffers, and null".

- [#777](https://github.com/forinda/kick-js/pull/777) [`1cce7a2`](https://github.com/forinda/kick-js/commit/1cce7a2dfdf6971f9a0c75cf2c8a83c9acb3389a) Thanks [@forinda](https://github.com/forinda)! - `uuid().defaultRandom()` on SQLite now generates a canonical version-4 UUID (`8-4-4-4-12`), not 32 bare hex characters — so a generated id passes the same UUID validation a Postgres one does (`z.uuid()` rejected it before). Applies to tables created or rebuilt by migrations generated from now on; existing columns keep their old default until the table is next rebuilt. Drift checks ignore SQLite defaults, so no drift is reported either way.

- [#792](https://github.com/forinda/kick-js/pull/792) [`a506117`](https://github.com/forinda/kick-js/commit/a5061172ed4a28e685ac77876fee050fd2ee8c4b) Thanks [@forinda](https://github.com/forinda)! - Tenancy hardening and fixes.
  
  - **`'column'` tenancy:**
    - It also filters the source tables of `UPDATE … FROM` and `DELETE … USING`.
    - An upsert's `DO UPDATE` is held to the tenant's rows, so a conflict on another tenant's row leaves it alone.
    - MySQL's `ON DUPLICATE KEY UPDATE`, `INSERT … SELECT`, `DEFAULT VALUES` and a non-literal tenant value are refused on tenanted tables, because their tenant can't be checked.
  - **`'rls'` streams:** a stream left early (`break`) rolls back its short transaction, so the connection never returns to the pool with the tenant still set.
  - **`insertSchema`:** the tenant column and `$defaultFn` columns are optional on insert.
  - **SQLite view introspection:** handles doubled quotes inside a view's column list.
  - **`pgDialect({ cursor })`:** takes `pg-cursor`'s `Cursor`, so `.stream()` works on Postgres.
  - Validators under `numeric(p, s, { mode: 'number' })` refuse a decimal with more than 15 significant digits, or one that isn't finite, instead of rounding it.

- [#790](https://github.com/forinda/kick-js/pull/790) [`cef336f`](https://github.com/forinda/kick-js/commit/cef336f841651435e529c3b37f135f9e1835bb6d) Thanks [@forinda](https://github.com/forinda)! - `createPgTestDb().drop()` no longer surfaces "terminating connection due to administrator command" as an uncaught error. `pool.end()` can resolve before a client's socket closes, and the forced `DROP DATABASE` then terminated that connection after the pool had detached its error listener. Each client now keeps its own listener.

- [#775](https://github.com/forinda/kick-js/pull/775) [`e4fabb6`](https://github.com/forinda/kick-js/commit/e4fabb6270c06dd781eab2d97d117e25e1e042b4) Thanks [@forinda](https://github.com/forinda)! - Work that outlives its transaction no longer looks like it's inside it. An async continuation started inside `transaction()` but still running after the commit (an un-awaited promise, say) used to see `inTransaction: true` and fail with Kysely's bare "Transaction is already committed". `inTransaction` is now `false` once the transaction (or savepoint) finishes, a query from that continuation throws `TransactionFinishedError` naming the likely cause, and `transaction()` / `afterCommit()` behave as outside a transaction.

## 8.0.0

### Major Changes

- [#766](https://github.com/forinda/kick-js/pull/766) [`c355676`](https://github.com/forinda/kick-js/commit/c35567636d03c4b5f42c59876d8ef1a07331b81b) Thanks [@forinda](https://github.com/forinda)! - New ways to declare a table, typed foreign keys, and no more annotation for self-references.
  
  **Table forms.** Each builds the same table `table()` would, with identical snapshots and migrations, so they can be mixed in one schema:
  
  - **`tableFromClass(Users)`** reads a class whose fields are column builders (`static readonly tableName = 'users'`). Self-references and cycles need no annotation.
  - **`class User extends TableBase('users', { ... }) {}`** makes the class the row type, and it can hold methods (`User.from(row)`). Exporting the class is enough: `kick db generate`, the codec plugin and `createDbClient({ schema })` all find its table.
  - **`defineTable('users').column(...).index(...).build()`** declares a table column by column. A repeated column is a type error, and `.column('parentId', (t) => fk(uuid(), () => t.id))` is a typed self-reference.
  
  **Validation rules travel with the table.** `@Rule(...)` on a builder field, `rules` on a `TableBase`, or `.column(key, builder, rule)` are typed against the column: a string rule on an integer column fails to compile. `insertSchema` / `selectSchema` / `updateSchema` apply these rules with no options, and `columns` still overrides them.
  
  **Foreign keys:**
  
  - **`selfRef('id')`** points a foreign key at the table's own column, in `table()` and every form, with no `(): ColumnRef =>` annotation. An unknown column fails when the table is declared.
  - **Column refs are typed:** they are now `TypedColumnRef<T>`, which is still assignable to `ColumnRef`, so existing code compiles.
  - **`fk(builder, () => target)`** is `.references()` with a type check: a uuid column pointing at a serial key is a type error.
  - **`link(column, () => target)`** adds a foreign key after both tables exist, so two tables can reference each other without an annotation.
  
  **Why major:** `TableDecl` gains the non-enumerable `__rules`, `SchemaToTypes` and snapshot extraction also accept a class carrying `static table`, and column refs change type. Code that inspects these shapes may need updating.

## 7.4.0

### Minor Changes

- [#765](https://github.com/forinda/kick-js/pull/765) [`b0a2011`](https://github.com/forinda/kick-js/commit/b0a201137b47ad023525a2124ca1aa12b9f84581) Thanks [@forinda](https://github.com/forinda)! - Validate requests with your tables: `insertSchema`, `selectSchema` and `updateSchema` from the new `@forinda/kickjs-db/schema` subpath.
  
  Each one turns a kick/db table into a schema a route validates with:
  
  ```ts
  export const createNote = insertSchema(notes, { omit: ['id'] })
  
  @Post('/', { body: createNote })
  ```
  
  Request validation, the Swagger spec, `kick typegen`'s `ctx.body` type and the typed client all take it the way they take a wrapped Zod schema, and it is a Standard Schema too. No schema library is needed. Export the schema as a named `const`: typegen reads the name, not an inline call.
  
  - **Per-column rules:** each column is checked by its SQL type. `varchar(n)` enforces a length, enums enforce their values, and dates, `bigint` and decimals are parsed to the column's TypeScript type. Nullability and database defaults decide what's required.
  - **`columns`:** adds what a table can't say, like `format: 'email'`, lengths, ranges and patterns, or a whole schema for a `json` column.
  - **`omit`:** leaves columns out.
  - **Row types:** also exports `InferSelect<typeof table>` and `InferInsert<typeof table>`.

### Patch Changes

- [#754](https://github.com/forinda/kick-js/pull/754) [`aec608f`](https://github.com/forinda/kick-js/commit/aec608f1287c078db2f80db18a052798d4ea4560) Thanks [@forinda](https://github.com/forinda)! - The missing-inverse relation error now points to the published guide (`kickjs.app/guide/db-relational-query#self-references-and-cycles`). Before, it named an internal spec file that isn't part of the published docs.

## 7.3.0

### Minor Changes

- [#660](https://github.com/forinda/kick-js/pull/660) [`0c4124b`](https://github.com/forinda/kick-js/commit/0c4124bd04eebfc04b4407d1abe22158139cbd88) Thanks [@forinda](https://github.com/forinda)! - `kick db introspect` now reads Postgres enum types ([#644](https://github.com/forinda/kick-js/issues/644)).
  
  Enum columns were introspected as their type name and then rendered as
  `text(/* TODO: enum_x */)`, and the types themselves were never read at all — so
  a schema regenerated from a database with 36 enum types had 37 columns of the
  wrong type and none of the types. The information was read and discarded.
  
  `introspectPg` now returns the enum types in `SchemaSnapshot.enums`, preserving
  value order (which for an enum is part of the type — comparisons and `ORDER BY`
  follow it), and the renderer emits a `pgEnum(...)` declaration per type and
  calls the factory for each column. `enums` is omitted entirely when the database
  declares none, so existing snapshots are byte-identical.
  
  The `pgEnum` builder and the `CREATE TYPE` emit path already shipped; this
  connects introspect to them.
  
  Also fixes the enum default in the schema guide: `.default('todo')`, not
  `.default("'todo'")` — the emitter quotes the value, and pre-quoting produced
  `DEFAULT '''todo'''`.

### Patch Changes

- [#661](https://github.com/forinda/kick-js/pull/661) [`8aa7c69`](https://github.com/forinda/kick-js/commit/8aa7c697270157def4e354497e89a03a2c553870) Thanks [@forinda](https://github.com/forinda)! - Fix `kick db generate` emitting invalid SQL for text-column defaults ([#646](https://github.com/forinda/kick-js/issues/646)).
  
  `formatDefault` decided how to render a default from the **value's** shape
  rather than the **column's** type, so anything that looked like SQL was passed
  through bare. A `varchar` column defaulting to `ACTIVE` produced
  `DEFAULT ACTIVE` — a syntax error — and the same applied to a text default that
  reads as a number (`0800`), a boolean (`true`), or a function call.
  
  This is not hypothetical for round-trips: introspect strips the quotes and cast
  off `'ACTIVE'::text`, so the snapshot legitimately holds the bare word and only
  the column type says how to put it back.
  
  A default is now quoted unless the column's type is one where a bare expression
  is legitimate — the integer family (`nextval(...)`), numeric, boolean, the
  temporal types (`CURRENT_TIMESTAMP`) and uuid (`gen_random_uuid()`). Stating it
  as an allow-list rather than its complement matters, because the complement is
  open-ended: every enum, domain and extension type an adopter declares falls
  outside it. Enum labels are the sharpest case — a label is always a literal, and
  one spelled `ACTIVE` or `1` reads as a keyword or a number to any value-shaped
  heuristic.
  
  A value already carrying an explicit cast (`'active'::"status"`, composed by the
  enum recreate path) is untouched.

- [#660](https://github.com/forinda/kick-js/pull/660) [`9afaee8`](https://github.com/forinda/kick-js/commit/9afaee889ff30c4dac8e4779d1c94f0f4fe7f9f2) Thanks [@forinda](https://github.com/forinda)! - Fix derived constraint names colliding past Postgres' 63-character limit ([#647](https://github.com/forinda/kick-js/issues/647)).
  
  `<table>_<column>_fk` and `<table>_<column>_unique` were emitted at whatever
  length they came out. Postgres does not reject an over-long identifier — it
  truncates silently — so two derived names sharing a long prefix became the same
  name and the migration failed part-way through with `constraint … already
  exists`, leaving every statement after it unapplied. A 242-table schema had 38
  names over the limit and two colliding pairs.
  
  Derived names that would exceed the limit are now shortened deterministically:
  truncated, with a short hash of the **full** name inserted before the `_fk` /
  `_unique` marker, so the result is stable across regenerations and two names
  that differ anywhere still differ. The limit is counted in bytes and a
  multi-byte character is never split. Names within the limit are untouched, so
  existing schemas keep every constraint name they have.
  
  `fitIdentifier()` is exported for anyone deriving names on the same rule.

- [#660](https://github.com/forinda/kick-js/pull/660) [`8426228`](https://github.com/forinda/kick-js/commit/8426228e7efb2b250d0899b4c8ac54aa491760dc) Thanks [@forinda](https://github.com/forinda)! - Fix two ways `kick db introspect` changed a column's meaning.
  
  **A column defaulting off a standalone sequence was rendered `serial()` ([#649](https://github.com/forinda/kick-js/issues/649)).**
  Detection keyed on the `nextval(...)` default alone, so an ordinary integer
  whose default came from a separately declared sequence was reported as a serial.
  That dropped the sequence link (a serial's default is collapsed to null) and,
  for a nullable column, silently made it NOT NULL. A column is now a serial only
  if it OWNS the sequence its default actually draws from, and is NOT NULL — a serial
  whose NOT NULL has been dropped comes back as a plain integer keeping its
  default, since re-imposing the constraint would reject the rows that caused it
  to be dropped.
  
  **Array columns lost their element type ([#648](https://github.com/forinda/kick-js/issues/648)).** Two causes: introspect
  reported PG's internal element name (`int4[]`, `bool[]`, `bpchar[]`) rather than
  the DSL's, and the renderer had no array branch at all, so every array fell
  through to `text(/* TODO */)`. Element names are now mapped to the DSL surface
  and arrays render as the element helper plus `.array()`. An unmapped element
  type still keeps its array-ness.

- [#659](https://github.com/forinda/kick-js/pull/659) [`c0b3760`](https://github.com/forinda/kick-js/commit/c0b3760b62c3f661d0ea7f7f07cc4b296e973f1b) Thanks [@forinda](https://github.com/forinda)! - Fix `kick db introspect` dropping every foreign key from a real database ([#643](https://github.com/forinda/kick-js/issues/643)).
  
  The renderer inlined a foreign key onto its column only when the constraint's
  name matched `<table>_<column>_fk` — the name this DSL derives. A database names
  its own constraints: Postgres' default is `<table>_<column>_fkey`, and a DBA may
  have chosen anything. So introspecting a live schema matched nothing and every
  key fell through to a TODO comment — 1,330 of them on a 242-table schema.
  
  Foreign keys are now matched on shape (one column, this column) rather than by
  name, and `.references()` takes a `name` option so the real constraint name
  survives the round-trip instead of the next diff proposing a rename of every
  key. Foreign keys the column DSL cannot express — composite ones, and every key
  on a column that carries more than one — still render as TODO comments.
  
  Database-supplied names (table, index, constraint) are also escaped when
  rendered, so a legal quoted identifier such as `customer'fk` no longer produces
  a schema file that does not parse.

## 7.2.1

### Patch Changes

- [#531](https://github.com/forinda/kick-js/pull/531) [`97aaab5`](https://github.com/forinda/kick-js/commit/97aaab589d3c5e159e8dfe9981a768b2f4f24ddb) Thanks [@forinda](https://github.com/forinda)! - Retire the `@forinda/kickjs-db-pg` / `-db-mysql` / `-db-sqlite` shim packages.
  
  They had been frozen as `private: true` nine-line re-exports of
  `@forinda/kickjs-db/{pg,mysql,sqlite}` since the dialects merged into this
  package, so they no longer publish — their last npm versions still resolve for
  existing installs. Their integration suites (121 tests) move here under
  `__tests__/{pg,sqlite,mysql}`; no runtime code changed.

## 7.2.0

### Minor Changes

- [#495](https://github.com/forinda/kick-js/pull/495) [`cddc77c`](https://github.com/forinda/kick-js/commit/cddc77c7a4f271ee69676543687c6811085c045f) Thanks [@forinda](https://github.com/forinda)! - feat: PostgreSQL named schemas via `pgSchema()`

  Tables can now live in a named PG schema:

  ```ts
  import { pgSchema } from "@forinda/kickjs-db/pg";

  const billing = pgSchema("billing");
  const invoices = billing.table("invoices", {
    id: serial().primaryKey(),
    ref: varchar(32).notNull(),
  });
  ```

  - Emits `CREATE SCHEMA IF NOT EXISTS "billing"` ahead of the tables that need it.
  - Qualifies every generated statement — `CREATE`/`DROP`/`ALTER TABLE`, `CREATE INDEX`, `DROP INDEX` (whose name resolves through `search_path`), and any `REFERENCES` pointing at the table.
  - Keys the row type as `KickDbSchema['billing.invoices']`, which Kysely reads as schema-qualified, so `db.selectFrom('billing.invoices')` resolves with no `withSchema()` call.
  - Two schemas may hold same-named tables: snapshot keys are qualified, so `billing.events` and `audit.events` no longer collide.

  `pgSchema('public')` collapses to "no schema" in both the runtime value and the type key — PG puts `public` on the default `search_path`, so treating it as a distinct key would make the diff emit `DROP TABLE users` + `CREATE TABLE public.users` for what is the same physical table.

  Schemas are never dropped. There is no `dropSchema` change: a schema can hold objects this app never declared, so a `DROP SCHEMA` inferred from "nothing references it any more" could destroy data the diff never saw. Down migrations leave the emptied schema for an operator to remove.

  PostgreSQL only — on MySQL a schema is a database and SQLite has none, so declaring one and diffing against those dialects throws at snapshot time, before any DDL is written.

  Unqualified tables are completely unaffected: no `schema` field is written, no `schemas` array is added, and snapshots serialize byte-identically, so existing migration hashes stay valid.

  Introspection is unchanged and still single-schema (`pgAdapter({ schema })`, default `public`) — tables in other schemas are created and migrated correctly but are not yet compared during drift detection.

  Also fixes a latent bug this surfaced: `diffTable` stamped the bare table name onto every column/index/FK change instead of the snapshot key.

## 7.1.1

### Patch Changes

- [#436](https://github.com/forinda/kick-js/pull/436) [`5ebb82e`](https://github.com/forinda/kick-js/commit/5ebb82e5266790a12e8b3ad6e6e776c469008783) Thanks [@forinda](https://github.com/forinda)! - docs: point package metadata and doc links at the canonical docs host (https://kickjs.app)

  The `homepage` field, README documentation links, CLI generator templates,
  and error-message doc URLs now reference https://kickjs.app instead of the
  retired GitHub Pages URL. No API or runtime behavior changes.

- Updated dependencies [[`5ebb82e`](https://github.com/forinda/kick-js/commit/5ebb82e5266790a12e8b3ad6e6e776c469008783)]:
  - @forinda/kickjs-cli-kit@0.1.2

## 7.1.0

### Minor Changes

- [#419](https://github.com/forinda/kick-js/pull/419) [`8bbf484`](https://github.com/forinda/kick-js/commit/8bbf484d0cbd1fb0abf5a55d21873bef41231e95) Thanks [@forinda](https://github.com/forinda)! - Live `kick/db` query telemetry in DevTools.
  - **`@forinda/kickjs-db`** now republishes every successful query to the DevTools event bus as **`db:query`** (`{ sql, parameters, durationMs, dialect }`), alongside the existing `db:slow-query` / `db:query-error`. Zero-overhead when no bus is wired (unchanged). The `db:query` event is added to the `KickDevtoolsEventRegistry` augmentation (`@forinda/kickjs-db/devtools-events`).
  - **`@forinda/kickjs-devtools`** gains a **Database** tab: a live recent-query table (time, dialect, duration with slow-query highlight, rows, SQL/error) with SQL filter and headline counters (queries / errors / slow / avg duration). It subscribes to `db:query` (successes) and `db:query-error` (failures) on the shared bus.

## 7.0.0

## 7.0.0-alpha.0

### Patch Changes

- Updated dependencies [[`d6622d5`](https://github.com/forinda/kick-js/commit/d6622d5d1d9c10cd2c446203fbaa2d143d13f2ea), [`fe1b578`](https://github.com/forinda/kick-js/commit/fe1b578344f5af05077c92023e5f549ddcb4edf4), [`79f2989`](https://github.com/forinda/kick-js/commit/79f298985606e6a1bf2bd2ae558910ad615226d1), [`3e5d03e`](https://github.com/forinda/kick-js/commit/3e5d03e7144a19ff26d44b7f882b86f564c6de17), [`d049c48`](https://github.com/forinda/kick-js/commit/d049c48015e1331eeae3f75ea4e536871cb03fd5), [`335c247`](https://github.com/forinda/kick-js/commit/335c24724293ff7c900f50ec20350b47d968f6e7), [`c6e4d73`](https://github.com/forinda/kick-js/commit/c6e4d73c2ad8be3725c91673451ab994a648a7f8), [`8fc8c1a`](https://github.com/forinda/kick-js/commit/8fc8c1a23d0e717edc1ccc54089141036a0ae975), [`0e18440`](https://github.com/forinda/kick-js/commit/0e1844075a074e11413c6811b0eb3137ee0c4b7c), [`d0bc46d`](https://github.com/forinda/kick-js/commit/d0bc46d7336fb9395c7b4f71fe74e94f1a2301e5), [`07a3a15`](https://github.com/forinda/kick-js/commit/07a3a15d51aaa55372e58ee2eafa11f6841245dd), [`d66dc5b`](https://github.com/forinda/kick-js/commit/d66dc5b337c8f961e4b9329607901bad850e0f91), [`841637e`](https://github.com/forinda/kick-js/commit/841637ec9d19f7df727db7342603e7e48bb07e25), [`6c59776`](https://github.com/forinda/kick-js/commit/6c5977641707cb533a86fcf701d249ef3bff3215), [`d500c8a`](https://github.com/forinda/kick-js/commit/d500c8a9d3b11277392e88e0369cb2fd2b39cf78)]:
  - @forinda/kickjs@5.18.0-alpha.0
  - @forinda/kickjs-devtools-kit@7.0.0-alpha.0

## 6.3.0

### Minor Changes

- [#365](https://github.com/forinda/kick-js/pull/365) [`7e3cbf2`](https://github.com/forinda/kick-js/commit/7e3cbf2d3e1f23b0648f3cb912ccf79cd2b59cec) Thanks [@forinda](https://github.com/forinda)! - Two query-layer safety additions:
  - **`escapeLike(input)` / `likePattern(input, mode)`** — escape LIKE/ILIKE metacharacters (`%`, `_`, and the escape char) so user search text matches literally. Without this, a user searching for `100%` produces a match-all pattern (or, with a leading wildcard, a full scan). `likePattern` builds the wrapped pattern for `'contains'` / `'startsWith'` / `'endsWith'` / `'exact'`.
  - **Explicit dialect tagging** — `pgDialect` / `mysqlDialect` / `sqliteDialect` now stamp a non-enumerable `KICK_DIALECT` marker, and `createDbClient`'s dialect detection reads it first. Previously detection relied solely on Kysely ctor-name regex (`/Postgres/i`) with a **silent fallback to SQLite** — a hand-rolled or future Kysely dialect whose ctor name didn't match was misclassified, emitting the wrong JSON-aggregation SQL. The ctor-name heuristic remains as the fallback for raw Kysely dialects. `markDialect` / `readDialectMark` are exported for adopters wrapping a raw dialect.

### Patch Changes

- [#367](https://github.com/forinda/kick-js/pull/367) [`191935b`](https://github.com/forinda/kick-js/commit/191935bdfe0f8f41ba829ce335ff43536d5cd3a6) Thanks [@forinda](https://github.com/forinda)! - `customType` codecs are keyed by column name, so two tables declaring a same-named column with _different_ codecs previously had one silently overwrite the other — corrupting encode/decode for one table with no signal. `createDbClient` now warns at startup when a column name maps to two different codec functions, names both tables, and keeps the first deterministically (first-write-wins instead of the old last-write-wins). Sharing one `customType` instance across tables is the common, safe case and stays silent.

## 6.2.0

### Minor Changes

- [#356](https://github.com/forinda/kick-js/pull/356) [`889fce7`](https://github.com/forinda/kick-js/commit/889fce7f2f02229d8af6bca062fb5642172add8d) Thanks [@forinda](https://github.com/forinda)! - Generated migration SQL files now carry an immutable provenance banner (`-- Generated by @forinda/kickjs-db vX.Y.Z — review state lives in meta.json`) instead of the mutable `-- REVIEWED: false` marker. Review state lives ONLY in `meta.json` — which the integrity hash does not cover — so reviewing a migration (or hand-flipping anything cosmetic) can no longer invalidate the journal hash. `kick db migrate review <id>` now flips `meta.json` only for banner-era migrations; legacy migrations with in-file markers still get the swap-and-rehash treatment. The unreviewed-migration error now names the review command instead of telling you to edit the marker.

### Patch Changes

- [#348](https://github.com/forinda/kick-js/pull/348) [`bdd9757`](https://github.com/forinda/kick-js/commit/bdd975792ace8fb4e53f542802db7f7610119fcc) Thanks [@forinda](https://github.com/forinda)! - Preserve `.notNull()` / `.primaryKey()` / `.default()` brands through `.array()`. Previously `integer().notNull().array()` silently dropped the NOT NULL marker, so `SchemaToTypes` emitted `number[] | null` for a NOT NULL column (and `.default(...).array()` lost the `Generated<T>` insert-optionality wrapper). Brand-last chains (`.array().notNull()`) were and remain correct.

- [#355](https://github.com/forinda/kick-js/pull/355) [`92c8ce5`](https://github.com/forinda/kick-js/commit/92c8ce5c28384c5e12cad34f1f4c41307b47b966) Thanks [@forinda](https://github.com/forinda)! - `kick db generate` no longer fails on SQLite for FK-bearing schemas. Inverting a migration now prunes `dropForeignKey` / `dropIndex` entries for tables the same down-set drops outright — `DROP TABLE` removes both, and on SQLite those drops compile to a table rebuild against the post-state snapshot, which no longer contains the table. Every first migration of a schema with foreign keys previously died with `SqliteRebuildRequiredError: no resolved snapshot for table 'X'` while emitting down.sql. Postgres/MySQL down migrations also lose the redundant pre-drop statements.

  Additionally, the sqlite adapter's `SqliteStatement.all`/`get` are no longer method-generic, so a real better-sqlite3 v12 `Database` passes `sqliteAdapter` / `sqliteDialect` without casts (same fix as `SqliteIntrospectDb`).

- [#351](https://github.com/forinda/kick-js/pull/351) [`57001c3`](https://github.com/forinda/kick-js/commit/57001c376090cf838db4c9b2dac672a317c21e33) Thanks [@forinda](https://github.com/forinda)! - `SqliteIntrospectDb.prepare(...).all` is no longer method-generic. better-sqlite3 v12's own `Statement.all(...params): Result[]` is non-generic, so the previous generic signature made a real `Database` instance structurally incompatible with `introspectSqlite(db)` — adopters had to cast. Row typing now happens inside the introspector; passing a better-sqlite3 `Database` directly type-checks.

- [#354](https://github.com/forinda/kick-js/pull/354) [`e8133d2`](https://github.com/forinda/kick-js/commit/e8133d2c0df13dd59db98637f4ec1a13181ff884) Thanks [@forinda](https://github.com/forinda)! - `kick/db` typegen now honours `db.schemaPath` from kick.config, matching `kick db generate`. Previously a custom schema path produced working migrations but a silently untyped client (the typegen only probed the default `src/db/schema*` candidates). A configured-but-missing path falls back to the default candidates instead of emitting a broken import.

## 6.1.1

### Patch Changes

- Updated dependencies [[`fe409a2`](https://github.com/forinda/kick-js/commit/fe409a2ef6c16384271e6536a93c89129bf2bccd)]:
  - @forinda/kickjs-cli-kit@0.1.1

## 6.1.0

### Minor Changes

- [#334](https://github.com/forinda/kick-js/pull/334) [`f050f6b`](https://github.com/forinda/kick-js/commit/f050f6b235d1fc54f7adc790cd2b5c999411c5c6) Thanks [@forinda](https://github.com/forinda)! - Ship the database CLI from `@forinda/kickjs-db/cli` — a mountable plugin **and** a standalone `kickjs-db` bin — so you can use the db tooling without (or alongside) `@forinda/kickjs-cli`.

  **New: `@forinda/kickjs-db/cli`**

  - `dbCliPlugin` — a CLI plugin (`@forinda/kickjs-cli-kit` contract). Mount it in `kick.config.ts` to get `kick db generate | migrate latest|up|down|rollback|status|review | introspect`. It reads config from the same `kick.config.ts` `db` block (via `ctx.config`, no re-parse).
  - `defineKickDbConfig` / `mergeKickDbConfig` / `resolveKickDbConfig` — vite-style config helpers. Author a standalone `kickjs-db.config.ts` (`export default defineKickDbConfig({ ... })`) or reuse the `kick.config.ts` `db` block; the two merge (later wins).
  - Standalone **`kickjs-db` bin** — `npx kickjs-db migrate latest` runs the whole command tree without kickjs-cli, loading `kickjs-db.config.ts` (or a `kick.config.ts` `db` block) through jiti.

  **Breaking (`@forinda/kickjs-cli`): `kick db` is now opt-in.**
  The `kick db` commands are no longer built into kickjs-cli. Add the plugin to your config:

  ```ts
  import { defineConfig } from "@forinda/kickjs-cli";
  import { dbCliPlugin } from "@forinda/kickjs-db/cli";

  export default defineConfig({ plugins: [dbCliPlugin] });
  ```

  Zero-config **db type generation is unchanged** — it stays a built-in typegen (`kick typegen` still emits `.kickjs/types` for your schema). Only the `kick db` _commands_ moved.

- [#331](https://github.com/forinda/kick-js/pull/331) [`4ba020e`](https://github.com/forinda/kick-js/commit/4ba020ed043dc0ee8f696661035891824a3e83f8) Thanks [@forinda](https://github.com/forinda)! - Consolidate the SQL dialect adapters into `@forinda/kickjs-db` subpaths.

  The PostgreSQL / SQLite / MySQL adapters + dialects now ship from **subpaths of `@forinda/kickjs-db`** instead of separate packages — mirroring how `@forinda/kickjs-schema` exposes `./zod` / `./valibot` / `./yup`. Install one package plus the single driver you use:

  ```bash
  # before
  pnpm add @forinda/kickjs-db @forinda/kickjs-db-pg pg
  # after
  pnpm add @forinda/kickjs-db pg
  ```

  ```ts
  // before
  import { pgAdapter, pgDialect } from "@forinda/kickjs-db-pg";
  // after
  import { pgAdapter, pgDialect } from "@forinda/kickjs-db/pg";
  ```

  - New subpaths: `@forinda/kickjs-db/pg` (now also carries `pgAdapter` + `pgDialect` alongside the PG column types), `@forinda/kickjs-db/sqlite`, `@forinda/kickjs-db/mysql`.
  - `pg`, `better-sqlite3`, `mysql2` are **optional peer deps** of `@forinda/kickjs-db` — the relevant subpath imports its driver lazily, so the core install never pulls all three.
  - `@forinda/kickjs-db-pg` / `-sqlite` / `-mysql` remain as **deprecated re-export shims** (`export * from '@forinda/kickjs-db/<dialect>'`) so existing installs keep working; they'll be removed in a future major.
  - CLI: `kick db` resolves the pg adapter from `@forinda/kickjs-db/pg`; `kick add pg|sqlite|mysql` installs `@forinda/kickjs-db` plus the matching driver.

- [#337](https://github.com/forinda/kick-js/pull/337) [`cf3ba8c`](https://github.com/forinda/kick-js/commit/cf3ba8cb56e70385cc6906371d2f8cb3846a2093) Thanks [@forinda](https://github.com/forinda)! - `introspect()` now works for SQLite and MySQL, so `kick db introspect` can reverse-engineer a live SQLite / MySQL database into a `schema.ts` (previously Postgres-only — the SQLite/MySQL adapters threw `KICK_DB_INTROSPECT_NOT_SUPPORTED`).

  - `introspectSqlite` walks `sqlite_master` + `PRAGMA table_info|index_list|index_info|foreign_key_list` (skips constraint auto-indexes, groups multi-column FKs).
  - `introspectMysql` walks `information_schema.{TABLES,COLUMNS,STATISTICS,KEY_COLUMN_USAGE,REFERENTIAL_CONSTRAINTS}`.
  - Both are exported (`introspectSqlite` / `introspectMysql`) and wired into their adapters' `introspect()`.

  Note: SQLite/MySQL introspection is **lossy** against a code-first snapshot — a `uuid()` column reads back as `text` / `char(36)` — so it powers schema reverse-engineering, not byte-exact drift detection. Drift stays off for those dialects pending a dialect-normalised compare; PostgreSQL drift is unaffected.

- [#336](https://github.com/forinda/kick-js/pull/336) [`3b00de4`](https://github.com/forinda/kick-js/commit/3b00de462ebe6f1772cfe0e44c1c04d3a45a4ddf) Thanks [@forinda](https://github.com/forinda)! - `kick db generate` now emits MySQL DDL when `db.dialect: 'mysql'`. Previously MySQL fell back to the Postgres emitter, which produced double-quoted identifiers and Postgres-only types that MySQL rejects.

  `emitMysql` mirrors the Postgres emitter's structure (MySQL has full `ALTER TABLE` support, unlike SQLite) with MySQL-specific output: backtick identifiers, PG→MySQL type mapping (`uuid`→`CHAR(36)`, `boolean`→`TINYINT(1)`, `serial`→`INT ... AUTO_INCREMENT`, `jsonb`→`JSON`, `text`→`TEXT`, length-preserving `varchar(n)`→`VARCHAR(n)`), normalised defaults (`gen_random_uuid()`→`(UUID())`, `now()`→`CURRENT_TIMESTAMP`, `false`→`0`), `alterColumn` via `MODIFY COLUMN`, and `dropForeignKey` via `DROP FOREIGN KEY`. The emitter is dispatched by dialect in `generate()`.

- [#339](https://github.com/forinda/kick-js/pull/339) [`66aae3c`](https://github.com/forinda/kick-js/commit/66aae3cf8c3bd87d14eaa0085d9ca15181fa97fe) Thanks [@forinda](https://github.com/forinda)! - Drift detection now works for SQLite and MySQL — `kick db migrate` catches out-of-band schema changes on all three dialects.

  SQLite/MySQL introspection is lossy against a code-first snapshot (a `uuid()` column reads back as `text` / `char(36)`, defaults normalise, SQLite drops FK names), so a raw comparison flagged drift on every migration. `checkDrift` now **canonicalises both sides** before diffing: column types run through the emit type-mapper (so `uuid` ≡ `text`), defaults are dropped, and FK names become a structural key. This catches the drift that matters — tables/columns added or removed, type/nullability/PK changes, indexes — without false positives. PostgreSQL still compares raw (faithful round-trip) and keeps default-level drift detection.

  **Behaviour change**: SQLite/MySQL `migrate` previously skipped drift entirely (it had no `introspect()`); it now defaults to `'error'` like Postgres. Tune it with the new `db.driftCheck` option (`'error'` | `'warn'` | `'ignore'`) in `kick.config.ts` / `kickjs-db.config.ts`.

  Verified end-to-end: a clean SQLite migrate passes the drift check (no false positive on lossy types), while an out-of-band `ALTER TABLE ... ADD COLUMN` is caught ("Schema drift detected: 1 added").

- [#332](https://github.com/forinda/kick-js/pull/332) [`456e280`](https://github.com/forinda/kick-js/commit/456e280eaef89b0d0c357a06edbde6f8e7c2c789) Thanks [@forinda](https://github.com/forinda)! - SQLite migration generation, a `migrate review` command, and drift handling for non-Postgres dialects.

  - **`kick db generate` now emits SQLite DDL** when `db.dialect: 'sqlite'`. Previously the migration emitter was Postgres-only, so SQLite projects couldn't generate migrations from their schema (only the runner worked). The new `emitSqlite` maps PG types to SQLite affinities, normalises defaults (`gen_random_uuid()` → `(lower(hex(randomblob(16))))`, `false` → `0`, `now()` → `CURRENT_TIMESTAMP`), inlines a single integer PK as `INTEGER PRIMARY KEY` (rowid), and folds foreign keys into `CREATE TABLE` (SQLite has no `ALTER ... ADD CONSTRAINT`). Operations SQLite can't express via `ALTER TABLE` (column type/null/default changes, FK changes on an existing table) throw a clear `SqliteRebuildRequiredError` pointing at `kick db generate --empty` instead of emitting wrong SQL. `generate` now dispatches the emitter by dialect.

  - **`kick db migrate review <id>`** marks a migration reviewed: it flips `meta.json.reviewed`, swaps the `-- REVIEWED: false` markers in `up.sql`/`down.sql`, and recomputes the journal hash so all three stay in sync. Previously the only way to review was hand-editing `meta.json`, which left the SQL markers and the hash out of sync (the runner gates on `meta.json.reviewed`, not the comment).

  - **Drift detection is skipped for SQLite/MySQL** — only the Postgres adapter implements `introspect()`, so `kick db migrate` no longer fails with "introspection not supported" on those dialects (PostgreSQL keeps the default `error` behaviour).

- [#338](https://github.com/forinda/kick-js/pull/338) [`e0e7c34`](https://github.com/forinda/kick-js/commit/e0e7c34ed46b70e1dcfecdf178a7d6f7e774beb9) Thanks [@forinda](https://github.com/forinda)! - `kick db generate` now emits a SQLite **table rebuild** for changes SQLite's `ALTER TABLE` can't express — column type/null/default alters and foreign-key add/drop on an existing table. Previously these threw `SqliteRebuildRequiredError` and had to be hand-authored.

  The emitter follows SQLite's recommended safe procedure: `CREATE TABLE _kick_new_<t>` with the desired shape → `INSERT ... SELECT` the surviving columns (the old/new column intersection, so data is preserved) → `DROP TABLE` → `RENAME` → recreate indexes. Verified end-to-end: a seeded row survives both `migrate up` and `migrate down` of a column-type change, with indexes intact.

  To build the new table the emitter needs the resolved before/after schema, so `generate()` now threads both snapshots into the SQLite emitter (`emitSqlite(changes, { from, to })`). Calling `emitSqlite(changes)` bare with a rebuild-requiring change still throws `SqliteRebuildRequiredError`.

  Limitation: the rebuild works for tables without **inbound** foreign-key references (the common case). A table that other tables' FKs point at would need `PRAGMA foreign_keys=OFF` outside the migration transaction — still out of scope.

- [#335](https://github.com/forinda/kick-js/pull/335) [`cda92e7`](https://github.com/forinda/kick-js/commit/cda92e79e0bdc7a6a46c4f428dc10da4ad115a8f) Thanks [@forinda](https://github.com/forinda)! - The `kick/db` type generation now ships on `dbCliPlugin` (exported as `kickDbTypegen` from `@forinda/kickjs-db/cli`), so mounting the plugin brings **both** the `kick db` commands and `.kickjs/types/kick__db.d.ts` generation from one opt-in.

  Previously the db typegen was a kickjs-cli built-in while the commands lived in the plugin — split across two packages. Now `@forinda/kickjs-db/cli` owns the full db CLI surface. kickjs-cli's `kickDbTypegen` export stays as a re-export shim for back-compat, but it is no longer auto-registered — add `dbCliPlugin` to `kick.config.ts` `plugins: []` to get db types (the same mount that enables the commands).

### Patch Changes

- [#330](https://github.com/forinda/kick-js/pull/330) [`91cf40f`](https://github.com/forinda/kick-js/commit/91cf40f2925b733dd39d46f3faf8ce29120c84f1) Thanks [@forinda](https://github.com/forinda)! - Fix `kick db` with plugin-importing configs, and non-string column defaults.

  - **`kick db` commands now load `kick.config.ts` through the CLI's jiti loader** (`loadKickConfig`) instead of `@forinda/kickjs-db`'s native `import()`. Native ESM can't resolve the extensionless, relative TypeScript imports a config commonly uses — e.g. `import { toolsPlugin } from './tools/cli-plugin'` to mount a CLI plugin — so every `kick db ...` command failed with `Cannot find module` whenever the config imported local TS. It now resolves exactly like the rest of the CLI.

  - **Column `.default()` accepts `string | number | boolean`** and normalises non-strings to their SQL-literal text. `boolean().default(false)` / `integer().default(0)` previously stored a raw boolean/number in the snapshot, which crashed migration emit with `value.replace is not a function`. The Postgres emitter (`formatDefault`) is also hardened to coerce booleans/numbers defensively, so a pre-existing snapshot with a non-string default emits a bare SQL literal (`false`, `0`) instead of throwing.

- Updated dependencies [[`b6b6832`](https://github.com/forinda/kick-js/commit/b6b683292596bec023104a7fc2b3d8e5a958f36a)]:
  - @forinda/kickjs-cli-kit@0.1.0

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
  import { createDbClient, safeNullComparison } from "@forinda/kickjs-db";

  const db = createDbClient({
    schema,
    dialect: pgDialect({ pool }),
    plugins: [safeNullComparison()],
  });

  await db
    .selectFrom("users")
    .where("deletedAt", "=", null)
    .selectAll()
    .execute();
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
        where: (_t, eb) => eb("id", "=", id),
        with: { comments: true, assignees: true, labels: true },
        signal,
      });
    }
  }

  @Controller()
  export class TasksController {
    constructor(private readonly tasks: TasksRepository) {}
    @Get("/tasks/:id")
    async show(ctx: RequestContext) {
      return ctx.json(await this.tasks.findFullById(ctx.params.id, ctx.signal));
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
  import type { KickDbClient, ReadonlyKysely } from "@forinda/kickjs-db";
  import type { KickDb } from "../db/schema"; // your SchemaToTypes alias

  @Service()
  export class WorkspacesQueryRepository {
    private readonly reader: ReadonlyKysely<KickDb>;

    constructor(@Inject(DB_PRIMARY) db: KickDbClient<KickDb>) {
      this.reader = db.qb as unknown as ReadonlyKysely<KickDb>;
    }

    list() {
      return this.reader.selectFrom("workspaces").selectAll().execute();
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
  import { createDbClient } from "@forinda/kickjs-db";
  import { CamelCasePlugin } from "kysely";

  const db = createDbClient({
    schema,
    dialect: pgDialect({ pool }),
    plugins: [new CamelCasePlugin()],
  });
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
  import Database from "better-sqlite3";
  import { createDbClient } from "@forinda/kickjs-db";
  import { sqliteAdapter, sqliteDialect } from "@forinda/kickjs-db-sqlite";

  const database = new Database("app.db");
  const db = createDbClient({ schema, dialect: sqliteDialect({ database }) });
  const migrationAdapter = sqliteAdapter({ database });
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
  import { createPool } from "mysql2/promise";
  import { createDbClient } from "@forinda/kickjs-db";
  import { mysqlAdapter, mysqlDialect } from "@forinda/kickjs-db-mysql";

  const pool = createPool({ host, user, password, database });
  const db = createDbClient({ schema, dialect: mysqlDialect({ pool }) });
  const migrationAdapter = mysqlAdapter({ pool });
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
  const db = createDbClient({ schema, dialect: mysqlDialect({ pool }) });

  const rows = await db.query.users.findMany({
    with: { posts: { with: { comments: true } } },
    where: (_u, eb) => eb("isActive", "=", true),
    limit: 20,
  });
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
      relationName: "sentMessages",
    }),
    recipient: one(users, {
      fields: [messages.recipientId],
      references: [users.id],
      relationName: "receivedMessages",
    }),
  }));

  relations(users, ({ many }) => ({
    sentMessages: many(messages, { relationName: "sentMessages" }),
    receivedMessages: many(messages, { relationName: "receivedMessages" }),
  }));
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
  const db = createDbClient({ schema, dialect: sqliteDialect({ database }) });

  const rows = await db.query.users.findMany({
    with: { posts: { with: { comments: true } } },
    where: (_u, eb) => eb("isActive", "=", true),
    limit: 20,
  });
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
  declare module "@forinda/kickjs-db" {
    interface KickDbRegister {
      db: KickDbClient<KickDbSchema>;
    }

    interface KickDbRelationsRegister {
      db: SchemaToRelationsRegister<typeof appSchema>;
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
  const db = createDbClient({ schema, dialect: pgDialect({ pool }) });

  const rows = await db.query.users.findMany({
    with: { posts: { with: { comments: true } } },
    where: (u, eb) => eb("isActive", "=", true),
    limit: 20,
  });
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
