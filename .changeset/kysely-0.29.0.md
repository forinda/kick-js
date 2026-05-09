---
'@forinda/kickjs-db': minor
'@forinda/kickjs-db-pg': minor
'@forinda/kickjs-db-mysql': minor
'@forinda/kickjs-db-sqlite': minor
---

chore(db): bump kysely from `0.28.16` to `0.29.0` across the db family

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
