# M3 Release Notes — v5.3.0

**Theme:** close every M2 carry-over, ship a real relational read API.

M3 is the milestone where `@forinda/kickjs-db` stops shipping with the "this exists, but…" caveat in its release notes. Three deferred items from M2 land at once:

- **Relational reads in one round trip** — `db.query.X.findMany({ with })` compiles to a single PostgreSQL query with `json_agg` / `to_json` aggregation. End-to-end typed via the `KickDbRelationsRegister` augmentation that the kick/db typegen plugin emits alongside the existing column-shape one.
- **Lossless `pgEnum` value removal** — `kick db generate` produces a real rename-recreate migration when an adopter removes a value, gated behind `--confirm-enum-drop` on the runner so the operator confirms the safety check before any DB write.
- **Babel-based devtools strip** — `kickjsVitePlugin()` ships a Babel transform that drops `defineDevtoolsRenderTab(...)` calls + `@forinda/kickjs-devtools-kit` imports from production bundles without requiring adopters to wrap every call in `__KICKJS_DEVTOOLS__`.

## Adopter-facing wins

### Relational reads in one round trip

```ts
const rows = await db.query.users.findMany({
  where: (u, eb) => eb('isActive', '=', true),
  orderBy: (_u, eb) => eb.ref('createdAt'),
  with: {
    posts: {
      where: (p, eb) => eb.isNotNull(p.publishedAt),
      with: { comments: true },
      limit: 5,
    },
  },
  limit: 20,
})
//  ^^^ User[] where each user has `posts: (Post & { comments: Comment[] })[]`
```

`findMany` / `findFirst` / `findUnique` all read through Kysely's `executeQuery` so existing events, plugins, and pool reuse keep working. PostgreSQL only in this release; SQLite and MySQL clients throw `RelationalQueryNotSupportedError` on first call until M4 lands those compilers.

`with` keys are checked against the `KickDbRelationsRegister` augmentation. The kick/db typegen plugin emits it alongside the column-shape one — adopters who run `kick typegen` (or `kick dev`) get auto-completion + compile-time errors on mistyped relation names. Adopters who hand-rolled the augmentation as an M3.A.5 stop-gap can delete that file once the typegen output covers it.

### Single-trip findFullById in `task-kickdb-api`

The example app's `TasksRepository.findFullById(id)` replaces what was a four-query N+1:

```ts
findFullById(id: string) {
  return this.db.query.tasks.findUnique({
    where: (_t, eb) => eb('id', '=', id),
    with: {
      comments: true,
      assignees: true,
      labels: true,
    },
  })
}
```

One round trip; Postgres handles the JSON aggregation; the row shape lands fully typed at the call site.

### Lossless `pgEnum` value removal

Removing a value from `pgEnum(...)` now produces a migration with a `-- KICK ENUM REMOVE` header + the rename-recreate dance:

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

The `USING column::text::foo` cast is the safety check — rows holding a removed value fail the cast and the whole transaction rolls back.

`kick db migrate latest` and `kick db migrate up` refuse to apply such a migration unless `--confirm-enum-drop` is passed. Without the flag, `MigrationEnumDropError` fires with the affected enums / values / columns _before any DB write_. Down-direction commands (`down`, `rollback`) bypass the gate — reversing a value removal is `ALTER TYPE … ADD VALUE`, always cheap.

### Babel-based devtools strip

Adopters wiring custom DevTools tabs at module top level previously had to wrap every call in `if (__KICKJS_DEVTOOLS__) { ... }` to keep dev-only code out of prod bundles. The new `kickjs:devtools-strip` plugin handles the top-level case automatically. On `vite build`:

- Imports from `@forinda/kickjs-devtools-kit` (and any sub-path) — dropped.
- Top-level `defineDevtoolsRenderTab(...)` / `defineDevtoolsTab(...)` calls bound from those imports — dropped.
- Side-effect imports of `*/devtools-events` augmentation modules — dropped.

In dev (`kick dev`), the plugin is a no-op so the devtools UI keeps working.

The strip is conservative: identifiers used inside function bodies stay. After the import is dropped those references become unresolved and the build fails loud — a deliberate signal so adopters who need `__KICKJS_DEVTOOLS__` gating still get one.

## Type-level wins

### `KickDbRelationsRegister` augmentation

The kick/db typegen plugin now emits three augmentations in `.kickjs/types/kick__db.d.ts`:

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

`SchemaToRelationsRegister<S>` is a new public type-level helper. It walks the schema barrel for `relations()` declarations and folds them into the registry shape — keyed by source table, each entry mapping `relationName → { kind, target }` with the target shrunk to the literal table name. Adding or removing a relation in `src/db/schema/relations.ts` flows through to call-site type-checking automatically.

### Type-narrowed `relations()`

`relations(source, builder)` and the `Helpers.one` / `Helpers.many` factories preserve the source name and target literal at the type level:

- `relations()` returns `RelationsDecl<TSourceName, TRelationsMap>` (was `RelationsDecl`).
- `Helpers.one` returns `RelationOne<TTarget>` (was `RelationOne`).
- `Helpers.many` returns `RelationMany<TTarget>` (was `RelationMany`).

Both `RelationsDecl<TSource, TRelations>` and the relation interfaces default their generics to the prior open shape, so existing `extends RelationsDecl` checks keep working — strictly narrowing, no break.

## Operator-facing wins

### `--confirm-enum-drop` flag

```bash
kick db migrate latest --confirm-enum-drop
kick db migrate up --confirm-enum-drop
```

Down-direction commands (`down`, `rollback`) do not require the flag.

### `MigrationEnumDropError`

Operators running `kick db migrate latest` against a pending migration with the `-- KICK ENUM REMOVE` header without the flag see:

```
Migration 20260505_002000_drop_priority_archived drops value(s)
'unused', 'archived' from PostgreSQL enum(s) "task_priority". Re-run
with `--confirm-enum-drop` (CLI) or `confirmEnumDrop: true`
(RunnerOptions) after reviewing the column-USING clauses in up.sql.
```

The runner refuses before any DB write — no partial application.

### `MigrationEnumDropError` exposed as a public type

Adopters running migrations programmatically can catch the error and surface a custom prompt:

```ts
try {
  await migrateLatest({ adapter, migrationsDir })
} catch (err) {
  if (err instanceof MigrationEnumDropError) {
    if (await confirm(`Drop ${err.removed.length} enum values?`)) {
      await migrateLatest({ adapter, migrationsDir, confirmEnumDrop: true })
    }
  } else {
    throw err
  }
}
```

## New public surface

### `@forinda/kickjs-db`

Type-level (relational query):

- `KickDbRelationsRegister` — adopter-augmentable registry; typegen emits.
- `RegisteredRelations`, `RelationMapEntry`, `TableRelations<Table>`.
- `FindManyOptions<DB, Table>`, `FindManyRow<DB, Table, Opts>`, `WithClause<DB, Rels>`.
- `QueryNamespace<DB>`, `TableQueryNamespace<DB, Table>`.
- `ResolvedRelation`, `ResolvedRelations`, `RelationSnapshot`.
- `SchemaToRelationsRegister<S>`.

Runtime (relational query):

- `KickDbClient<DB>.query: QueryNamespace<DB>` — Proxy-backed namespace.
- Errors: `RelationalQueryUnknownRelationError`, `RelationalQueryDepthError`, `RelationalQueryAliasCollisionError`, `RelationalQueryMissingInverseError`, `RelationalQueryNotSupportedError`.

Migration runner (enum drop):

- `RunnerOptions.confirmEnumDrop?: boolean`.
- `MigrationEnumDropError`.
- `parseEnumDropHeader(sql)`, `enforceEnumDropGate(id, sql, confirmEnumDrop)`, `EnumDropHeader`.
- `RemoveEnumValue` extended with `values`, `affectedColumns` for adopters who read the diff output programmatically.

### `@forinda/kickjs-cli`

- `kick db migrate latest --confirm-enum-drop` (also on `kick db migrate up`).
- `kick/db` typegen plugin emits `KickDbRelationsRegister.db = SchemaToRelationsRegister<typeof appSchema>` alongside the existing `KickDbRegister`.

### `@forinda/kickjs-vite`

- `kickjsVitePlugin()` now registers `kickjs:devtools-strip` alongside `kickjs:devtools-flag` (gated on `options.devtools !== false`).
- Standalone exports: `devtoolsStripPlugin(opts?)`, `stripDevtoolsCode(source, filename, opts?)`, `DevtoolsStripOptions`, `StripDevtoolsOptions`, `StripResult`.
- New direct dependency: `@babel/core ^7.29.0`.

## Out of scope (deferred to M4)

- **SQLite + MySQL relational query compilers.** The interface is in place; the dialects throw `RelationalQueryNotSupportedError` on first call. Implementing them is straightforward (`json_group_array` + `JSON_ARRAYAGG`), just dialect-shaped work.
- **`relationName` for multi-FK disambiguation.** When two tables share more than one FK, our `many` resolver currently fails on the FK introspection fallback. Drizzle's symmetric `relationName: 'foo'` pattern lands as a follow-up.
- **Composite-type detection** for `pgEnum` removal (PG records / arrays containing the enum). v1 emits the rename-recreate without scanning composites.
- **Bundle-size assertion** for the Babel devtools strip — needs an example-app build harness; tracked for a follow-up.
- **Testcontainers integration test** for `pgEnum` value removal — unit + parser coverage in this release; full PG round-trip is a follow-up.

## Migration notes

### From v5.2 adopter projects using `relations()`

The `relations()` helper now returns a more specific type. Existing callers stay assignable to the prior open shape; nothing to update unless code explicitly types intermediate values:

```diff
- const usersRelations: RelationsDecl = relations(users, ({ many }) => ({ posts: many(posts) }))
+ const usersRelations = relations(users, ({ many }) => ({ posts: many(posts) }))
```

The explicit type annotation widens to the open shape and loses the typegen path. Drop the annotation and let inference flow.

### From v5.2 adopter projects with hand-rolled `KickDbRelationsRegister`

If you wrote the augmentation by hand (M3.A.5 stop-gap), delete it. Re-running `kick typegen` produces the equivalent `.kickjs/types/kick__db.d.ts` output.

### From v5.2 adopter projects using DevTools tabs

If you wrap every devtools call in `if (__KICKJS_DEVTOOLS__) { ... }`, no change. The flag plugin's constant-folding still runs first; the new Babel strip handles the residual cases the flag couldn't reach.

If you call `defineDevtoolsRenderTab(...)` at module top level without gating, the strip handles it automatically. References inside function bodies still need the flag — the strip leaves them alone, and the build fails loud after the import is dropped.

## Stats

- 6 commits across `packages/db`, `packages/cli`, `packages/vite`, `examples/task-kickdb-api`, and `docs/db`.
- 5 changesets staged on `feat/db-relational-query-m3`:
  - `db-relational-query-types-and-pg-compiler.md` — `@forinda/kickjs-db` minor (M3.A.2 + A.3).
  - `db-relational-query-runtime-wireup.md` — `@forinda/kickjs-db` minor (M3.A.4).
  - `db-cli-relations-typegen.md` — `@forinda/kickjs-db` + `@forinda/kickjs-cli` minor (M3.A.7).
  - `vite-devtools-babel-strip.md` — `@forinda/kickjs-vite` minor (M3.C).
  - `db-cli-pgenum-value-removal.md` — `@forinda/kickjs-db` + `@forinda/kickjs-cli` minor (M3.B).
- Test counts (final):
  - `@forinda/kickjs-db`: **53 files / 306 tests** (was 199 at M2 cut; +107 net across the milestone).
  - `@forinda/kickjs-db-pg`: **4 files / 23 tests** (was 17; +6 from M3.A.5 real-PG integration).
  - `@forinda/kickjs-cli`: **24 files / 231 tests** (typegen-db-plugin updated for the relations augmentation).
  - `@forinda/kickjs-vite`: **3 files / 77 tests** (was 2 / 76; +1 file, +1 test net).
