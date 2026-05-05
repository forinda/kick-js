---
'@forinda/kickjs-db': minor
---

Add the relational-query type surface and PostgreSQL compiler that back `db.query.X.findMany({ with })`. The runtime wire-up that exposes `db.query` on the client lands in a follow-up; this changeset ships the types, errors, and SQL emitter.

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
