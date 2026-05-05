# Spec — Relational query layer: SQLite + MySQL compilers

> **Status:** Draft v1 — 2026-05-05. Sub-spec for [`m4-plan.md`](./m4-plan.md) §M4.A. Locks the per-dialect aggregation strategy, the `ParseJSONResultsPlugin` requirement, the dialect-detection rule, and the new peer-package boundaries before code starts.

**Owner:** kickjs-db maintainers
**Architecture parent:** [`spec-relational-query.md`](./spec-relational-query.md) §4 "SQL strategy" → §4.3 "SQLite + MySQL (stubs in v1)"
**Related code:** `packages/db/src/query/compile-pg.ts` (PG reference impl), `packages/db/src/query/compilers.ts` (dialect picker — currently has throw-stubs for non-PG), `packages/db/src/query/errors.ts` (`RelationalQueryNotSupportedError`)

---

## 1. Problem

v5.3 ships `db.query.X.findMany({ with })` for PostgreSQL only. SQLite and MySQL clients throw `RelationalQueryNotSupportedError` on first call. That's a clear caveat in the release notes but a real gap for adopters running on those engines.

The interface is already shaped for cross-dialect impls — `pickCompiler(dialect)` switches on the runtime tag. M4.A swaps the two throw-stubs for real compilers. The PG strategy (LATERAL + `jsonArrayFrom` / `jsonObjectFrom` from `kysely/helpers/postgres`) translates cleanly because Kysely ships equivalent helpers under `kysely/helpers/sqlite` and `kysely/helpers/mysql`.

The wrinkle: PG's driver decodes JSON columns to JS values natively; SQLite + MySQL drivers return them as strings. Both Kysely helpers document that adopters must register the `ParseJSONResultsPlugin` to round-trip nested results. M4.A inherits this requirement.

---

## 2. Goals

1. **Per-dialect compile path produces correct row shapes.** Same `db.query.X.findMany({ with })` call, three SQL outputs, three JS row trees that match the type-system declared shape.
2. **Single source of truth for the compile algorithm.** The traversal logic (with-walking, alias generation, `where` / `orderBy` / `limit` plumbing) lives in one place. Per-dialect impls differ only in the `jsonArrayFrom` / `jsonObjectFrom` import.
3. **No driver pulled into `@forinda/kickjs-db` core.** Each dialect ships its own peer package (`db-sqlite`, `db-mysql`) following the existing `db-pg` template. Adopters install only the adapter they need.
4. **Auto-attached `ParseJSONResultsPlugin` for SQLite + MySQL clients.** Adopters never have to wire it manually — `createDbClient` detects the dialect and registers the plugin. Skipping it on PG (where it's not needed) keeps the plugin chain minimal.
5. **Drop the throw-stub.** After M4.A, `pickCompiler(dialect)` returns a real impl for all three dialects.

## Non-goals

1. **MySQL 5.x.** Drops `JSON_ARRAYAGG` (MySQL 8.0+ only). v1 refuses with a clearer error if the runtime version is < 8.0.
2. **MSSQL.** Kysely ships an mssql helper (`kysely/helpers/mssql`) but there's no `@forinda/kickjs-db-mssql` adapter today. Out of scope for M4; tracked for M5+.
3. **CockroachDB / Yugabyte / TiDB.** PG-wire-protocol-compatible engines that _should_ work via the PG path. Not formally supported in v1; integration tests for them land separately.
4. **D1 (Cloudflare) / Bun-sqlite parity.** SQLite-flavored runtimes that _should_ work via the SQLite path. v1 supports `better-sqlite3` only; D1 + Bun are documented as untested-but-likely-fine.
5. **Per-relation `select` projection** inside `with`. Same non-goal as M3.A — always select all columns of related rows in v1.

---

## 3. Per-dialect SQL strategy

### 3.1 SQLite

Kysely's `kysely/helpers/sqlite` exports `jsonArrayFrom` and `jsonObjectFrom`. Generated SQL:

```sql
-- jsonArrayFrom (many)
select "id", (
  select coalesce(json_group_array(json_object(
    'pet_id', "agg"."pet_id",
    'name',   "agg"."name"
  )), '[]') from (
    select "pet"."id" as "pet_id", "pet"."name"
    from "pet"
    where "pet"."owner_id" = "person"."id"
    order by "pet"."name"
  ) as "agg"
) as "pets"
from "person"
```

Key notes:

1. **No LATERAL.** SQLite uses correlated subqueries — `(SELECT … WHERE inner.fk = outer.pk)` references the outer row by lexical scope. Kysely's helper handles this automatically; adopter call shape is identical to PG's.
2. **`coalesce(json_group_array(...), '[]')`** — SQLite's `json_group_array` returns `'[]'` over zero rows in current versions, but Kysely defensively wraps anyway to handle older SQLite builds (≤3.37).
3. **`json_object` argument order** preserves declaration order at runtime; tested behavior across `better-sqlite3 ≥10`.
4. **Result shape is a JSON string** until `ParseJSONResultsPlugin` rewrites it to a parsed object. See §5.
5. **Self-references compile fine.** The depth-suffixed alias scheme from M3.A (`categories_0`, `categories_1`, …) carries through unchanged.

`jsonObjectFrom` uses the same SQLite primitives without the array wrapper:

```sql
-- jsonObjectFrom (one)
select "id", (
  select json_object('id', "agg"."id", 'name', "agg"."name")
  from (
    select "user"."id", "user"."name"
    from "user"
    where "user"."id" = "post"."author_id"
    limit 1
  ) as "agg"
) as "author"
from "post"
```

Empty inner row returns `NULL` from `json_object` (SQLite-side) — matches the `Related | null` type at the call site.

### 3.2 MySQL

Kysely's `kysely/helpers/mysql` exports `jsonArrayFrom` and `jsonObjectFrom`. Generated SQL:

```sql
-- jsonArrayFrom (many)
select `id`, (
  select cast(coalesce(json_arrayagg(json_object(
    'pet_id', `agg`.`pet_id`,
    'name',   `agg`.`name`
  )), '[]') as json) from (
    select `pet`.`id` as `pet_id`, `pet`.`name`
    from `pet`
    where `pet`.`owner_id` = `person`.`id`
    order by `pet`.`name`
  ) as `agg`
) as `pets`
from `person`
```

Key notes:

1. **`JSON_ARRAYAGG` over zero rows returns `NULL`.** Kysely's helper wraps in `coalesce(..., '[]')` + `cast(... as json)` so the result is always a JSON array. Spec §4.1 from PG ("`many` returns `[]`, never `null`") holds across all three dialects.
2. **MySQL 8.0+ required.** `JSON_ARRAYAGG` shipped in 8.0; earlier versions don't have it. v1 refuses on < 8.0 with `RelationalQueryNotSupportedError` carrying the version detected.
3. **Lateral derived tables (8.0.14+)** would be cleaner for nested `with` than correlated subqueries, but the Kysely helper falls back to correlated subqueries when the depth exceeds one level. v1 accepts the correlation approach; profiling against `JSON_ARRAYAGG`-heavy workloads can drive a future LATERAL switch.
4. **Backtick identifiers** instead of double quotes. Identical adopter API; the dialect-specific quoting is Kysely's concern.

`jsonObjectFrom` uses `JSON_OBJECT(...)`:

```sql
-- jsonObjectFrom (one)
select `id`, (
  select json_object('id', `agg`.`id`, 'name', `agg`.`name`)
  from (
    select `user`.`id`, `user`.`name`
    from `user`
    where `user`.`id` = `post`.`author_id`
    limit 1
  ) as `agg`
) as `author`
from `post`
```

Empty inner returns `NULL` from `JSON_OBJECT` over zero rows — matches the `Related | null` type.

### 3.3 PG vs SQLite vs MySQL — invariants

| Property                                    | PG              | SQLite              | MySQL               |
| ------------------------------------------- | --------------- | ------------------- | ------------------- |
| `many` empty-set                            | `[]`            | `[]`                | `[]` (via coalesce) |
| `one` empty-row                             | `null`          | `null`              | `null`              |
| Outer-row correlation                       | LATERAL         | correlated subquery | correlated subquery |
| `ORDER BY` inside aggregation               | preserved       | preserved           | preserved           |
| `LIMIT` inside `with`                       | inner subquery  | inner subquery      | inner subquery      |
| Identifier quoting                          | `"col"`         | `"col"`             | `` `col` ``         |
| Result decoded to JS object pre-row-handler | yes (PG driver) | no — needs plugin   | no — needs plugin   |
| Min version                                 | 9.5+            | 3.38+ (json1)       | **8.0.0+**          |

The first six rows mean adopter code stays identical across dialects. The last two — driver decoding + min version — drive the plugin auto-attach (§5) and the runtime version assertion (§7).

---

## 4. Dialect picker + compile interface

`pickCompiler(dialect)` (`packages/db/src/query/compilers.ts`) currently:

```ts
export function pickCompiler(dialect: 'postgres' | 'sqlite' | 'mysql'): CompileFn {
  if (dialect === 'postgres') return compilePg as CompileFn
  return compileNotSupported(dialect)
}
```

After M4.A:

```ts
import { compilePg } from './compile-pg'
import { compileSqlite } from './compile-sqlite'
import { compileMysql } from './compile-mysql'

export function pickCompiler(dialect: 'postgres' | 'sqlite' | 'mysql'): CompileFn {
  switch (dialect) {
    case 'postgres':
      return compilePg
    case 'sqlite':
      return compileSqlite
    case 'mysql':
      return compileMysql
  }
}
```

`compileSqlite` and `compileMysql` are direct ports of `compilePg`. The only difference per file: which Kysely helper the file imports. The traversal helpers (`applyWithSelects`, `buildInnerSelect`, `applyWhereOrderLimit`, `makeAlias`, `makeTableRefProxy`) move to a shared `query/compile-shared.ts` module so all three dialects use the same logic.

Sketch:

```ts
// query/compile-shared.ts — exports the dialect-agnostic helpers.
export function applyWithSelects(
  query: any,
  source: string,
  sourceAlias: string,
  withClause: ...,
  relations: ResolvedRelations,
  helpers: { jsonArrayFrom: typeof JsonArrayHelper; jsonObjectFrom: typeof JsonObjectHelper },
  ...
)

// query/compile-sqlite.ts
import { jsonArrayFrom, jsonObjectFrom } from 'kysely/helpers/sqlite'
import { applyWithSelects, ... } from './compile-shared'
export const compileSqlite: CompileFn = (db, table, options, relations, mode) => {
  // Same shape as compilePg — passes the SQLite helpers into the shared traversal.
}
```

This keeps M4.A focused: extract the traversal once, wire three dialect entry points around it.

### 4.1 Dialect detection

`detectDialect(KyselyDialect)` already inspects both the dialect's constructor name and the adapter class returned by `createAdapter()`. After M4.A it stays unchanged — the existing return values (`'postgres' | 'sqlite' | 'mysql'`) cover all three real impls. Hand-rolled `KyselyDialect` literals keep working via the adapter-class fallback (M3.A.4 fix).

Edge cases the detection accepts:

| Input                                                                                        | Detected as |
| -------------------------------------------------------------------------------------------- | ----------- |
| `new PostgresDialect({ pool })` (kysely + node-postgres)                                     | `postgres`  |
| `new PostgresDialect({ pool: neonPool })` (neon-http via PG-compatible pool)                 | `postgres`  |
| `new SqliteDialect({ database: betterSqlite3 })`                                             | `sqlite`    |
| `new MysqlDialect({ pool: mysql2Pool })`                                                     | `mysql`     |
| `{ createAdapter: () => new PostgresAdapter(), createDriver: () => new DummyDriver(), ... }` | `postgres`  |

Edge cases v1 _does not_ attempt to detect:

- **CockroachDB / TiDB / Yugabyte** — PG-wire-compatible. Detected as `postgres`, compiles via `compilePg`. Mostly works; documented as untested.
- **libSQL / Turso** — SQLite-flavored. Detected as `sqlite` if adopter wires through the kysely-libsql dialect (which extends `SqliteAdapter`). Documented as untested.
- **D1** — Cloudflare's SQLite engine. Same as libSQL.

---

## 5. `ParseJSONResultsPlugin` auto-attach

Kysely's helper docs explicitly call out: SQLite + MySQL drivers return JSON columns as strings, and `jsonArrayFrom` / `jsonObjectFrom` produce nested rows that need parsing. The recommended fix is registering `ParseJSONResultsPlugin` on the Kysely instance.

`createDbClient` already configures the Kysely plugin chain (M2's codec plugin path). M4.A extends:

```ts
// client/create.ts
const plugins: KyselyPlugin[] = []
if (codecPlugin) plugins.push(codecPlugin)
if (dialectTag === 'sqlite' || dialectTag === 'mysql') {
  plugins.push(new ParseJSONResultsPlugin())
}
// PG driver decodes JSON natively — skip the plugin to keep the chain minimal.
```

Adopters who already register the plugin (e.g. for ad-hoc `jsonArrayFrom` calls outside `db.query`) end up with two instances. The plugin is idempotent — the second pass over already-parsed values is a no-op — but we de-duplicate by `instanceof` check on `opts.plugins` if the adopter passes it explicitly. A tiny wart, documented.

Custom-type round-trip (M2.F's `customType.fromDriver`) runs _after_ the JSON parse plugin. Order matters: parse strings to objects first, then walk the row tree applying `fromDriver` per-column. The codec plugin's existing visitor handles the post-parse case correctly because it walks the result tree by column name, not by string vs object.

---

## 6. Peer-package boundaries

Following the `@forinda/kickjs-db-pg` template:

```
packages/db-sqlite/
  package.json                 deps: kysely, devDeps: better-sqlite3 + @types
  src/
    adapter.ts                 SqliteAdapter via @forinda/kickjs-db's MigrationAdapter
    dialect.ts                 sqliteDialect({ database }) → KyselyDialect
    index.ts                   barrel
  __tests__/integration/
    adapter.test.ts            ensureMigrationTables / lock / record / drift round trip
    relational-query.test.ts   db.query.X.findMany({ with }) end-to-end
    client.test.ts             createDbClient + transactions

packages/db-mysql/
  package.json                 deps: kysely, devDeps: mysql2 + Testcontainers
  src/
    adapter.ts                 MysqlAdapter
    dialect.ts                 mysqlDialect({ pool }) → KyselyDialect
    index.ts
  __tests__/integration/
    adapter.test.ts            same shape as db-pg's adapter test
    relational-query.test.ts   Testcontainers MySQL 8 round trip
    client.test.ts             createDbClient + transactions
```

Both packages ship at `0.1.0` initially (changeset assigns the first published version). They are **not** linked-version peers of `@forinda/kickjs-db` — adopters can pin them independently.

The `MigrationAdapter` interface from M1 already abstracts the connection layer; `db-sqlite` + `db-mysql` implement it the same way `db-pg` does. The `runner.ts` enum-drop gate from M3.B is dialect-agnostic — applies to all three. (The rename-recreate emit only fires from `emitPg` though; SQLite + MySQL adopters who hit a value removal still get the gate fired on whatever SQL the future SQLite/MySQL emitter produces.)

---

## 7. Resolved decisions (defaults locked)

- **R-1 — MySQL minimum version: 8.0.** Earlier versions don't have `JSON_ARRAYAGG`. `mysqlAdapter()` runs `SELECT VERSION()` on first connection and throws `RelationalQueryNotSupportedError('mysql', { reason: 'requires_8_plus', detected: '5.7.x' })` if the major < 8. Resolved 2026-05-05.
- **R-2 — `ParseJSONResultsPlugin` auto-attach for SQLite + MySQL.** Skip on PG. De-dupe by `instanceof` if adopter also passes one. Resolved 2026-05-05.
- **R-3 — Shared traversal in `compile-shared.ts`.** Per-dialect file is ~30 lines (entry point + helper imports). Avoids three near-identical 200-line files. Resolved 2026-05-05.
- **R-4 — CockroachDB / TiDB / Yugabyte detection: route to `compilePg`.** PG-wire-compatible. Documented as untested but expected-to-work. Resolved 2026-05-05.
- **R-5 — libSQL / Turso / D1 detection: route to `compileSqlite`.** SQLite-flavored. Same untested-but-expected disposition. Resolved 2026-05-05.
- **R-6 — `db-sqlite` + `db-mysql` start at 0.1.0**, not linked to `db@x.y.z`. Adopters pin independently. Resolved 2026-05-05.

---

## 8. Edge cases

| Case                                              | Behavior                                                                                                          |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| MySQL < 8.0                                       | `mysqlAdapter()` throws `RelationalQueryNotSupportedError` on first connection — fail-fast at boot, not at query. |
| SQLite < 3.38 (no JSON1)                          | Build-time concern — `better-sqlite3` ships with JSON1 enabled in current versions. Documented; no runtime check. |
| `customType.fromDriver` inside nested `with`      | Fires post-`ParseJSONResultsPlugin`. Codec walker reads column names from the parsed object, not the JSON string. |
| Adopter passes their own `ParseJSONResultsPlugin` | Detected via `instanceof`; we skip auto-attach to avoid duplicate registration.                                   |
| MySQL `JSON_OBJECT` over `bytea`                  | MySQL doesn't have `bytea`; the analogous `BLOB` round-trips as base64 inside JSON. Documented.                   |
| SQLite numeric coercion in JSON                   | `json_object` preserves declared types — `INTEGER PRIMARY KEY` round-trips as JS number. `REAL` likewise.         |
| Self-reference depth > 5 on SQLite                | Same `RelationalQueryDepthError` as PG. Depth cap is dialect-agnostic.                                            |
| Concurrent connections in MySQL                   | `mysql2` pool config flows through `mysqlDialect({ pool })` unchanged — no kickjs-db ceremony.                    |

---

## 9. Open questions

None at draft v1 — every decision in §7 has a default. Reviewer can flip any of R-1 through R-6 before code starts.

---

## 10. Acceptance — exits the spec when

- [ ] Reviewer sign-off on §3 (per-dialect SQL) and §4 (compile interface).
- [ ] §7 resolved decisions accepted as written, or specific items called out for flipping.
- [ ] No outstanding "Todo" or "TBD" lines in this file.
- [ ] `m4-plan.md` Step A.1 marked `[x]`.

Spec is locked. M4.A.2 (SQLite compiler) becomes the next session.

---

## 11. Changelog

| Date       | Author | Note           |
| ---------- | ------ | -------------- |
| 2026-05-05 | claude | Initial draft. |
