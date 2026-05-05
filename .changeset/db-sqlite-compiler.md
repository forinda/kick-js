---
'@forinda/kickjs-db': minor
---

`db.query.X.findMany({ with })` now works on SQLite. M4.A.2 from `docs/db/m4-plan.md` — closes the "PG only" caveat for SQLite adopters; MySQL ships in M4.A.3.

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

**`CompileFn` signature** gained a `tables: Record<string, TableSnapshot>` parameter (now 6 args). Adopters calling `compilePg` / `compileSqlite` directly need to pass the tables map alongside `relations`. `createDbClient`-based call sites are unaffected — `extractSnapshot` already produces the map and threads it through `InternalContext.query.tables`.

**Adopter migration:** none for `db.query.X.findMany`-based usage. Adopters calling the dialect compilers directly (rare; mostly internal) need to add the `tables` argument.

Spec: `docs/db/spec-relational-query-other-dialects.md`. Tests: 13 new SQLite snapshot fixtures mirroring the PG suite + 2 new builder integration tests asserting the SQLite path via `kysely/helpers/sqlite`. Suite at 326 tests (was 312; +14).
