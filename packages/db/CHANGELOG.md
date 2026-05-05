# @forinda/kickjs-db

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
