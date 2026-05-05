---
'@forinda/kickjs-db': minor
---

`db.query.X.findMany({ with })` now works on MySQL 8.0+. M4.A.3 from `docs/db/m4-plan.md` — closes the "PG only" caveat that started in v5.3 and shrank with M4.A.2 (SQLite). All three dialects now ship real compilers; the `RelationalQueryNotSupportedError` throw-stub is retired.

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
