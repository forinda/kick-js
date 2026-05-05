# M3 — Plan: Close M2 deferreds

> **Status (2026-05-05):** Draft. Tracks the three M2 carry-overs that remain after the audit on 2026-05-05. Once all three ship, the "Out of scope" section of [`m2-release.md`](./m2-release.md) can be deleted and a v5.3 release notes doc replaces this plan.

**Goal:** Land the three deferred items from M2 so `@forinda/kickjs-db` no longer ships with documented "this exists, but…" caveats. Specifically: relational reads in one round trip, lossless enum migration, and clean prod bundles for adopters who use DevTools tabs.

**Architecture:** Three independent sub-milestones — they do not share state and can run in parallel if more than one contributor is available. Same conventions as M0/M1/M2: phantom-typed surfaces, snapshot/diff/emit pipeline as the single source of truth for migrations, no Reflect-based introspection.

**Tech stack:** Same as M2 — TypeScript, Vitest + SWC, tsdown, wireit, Kysely, Testcontainers PG. M3.C adds `@babel/core` + `@babel/plugin-transform-typescript` (peer dep on `@forinda/kickjs-vite` only).

**Specs to write before code:**

- `docs/db/spec-relational-query.md` — written **before** M3.A starts. Locks the dialect-specific JSON-aggregation strategy (PG `json_agg` / SQLite `json_group_array` / MySQL `JSON_ARRAYAGG`) and the type-level shape of the `with` clause. The M2 plan reserved this slot but punted the design.
- `docs/db/spec-enum-value-removal.md` — short. Documents the migration-file shape (`-- KICK ENUM REMOVE`) and the operator-facing CLI flow when columns reference the dropped value.

**Prereq:** M2 shipped + plan headers updated (done 2026-05-05).

---

## Estimated cadence

| Sub-milestone                        | Scope                                                                                                | Days | Blockers                                 |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------- | ---- | ---------------------------------------- |
| M3.A — Relational `findMany({with})` | Spec + `packages/db/src/query/` + dialect compilers + `expectTypeOf` suite                           | 8–10 | spec-relational-query.md must land first |
| M3.B — Removed-enum-value handling   | Diff/invert path + emitted SQL templates + operator CLI flag (`kick db migrate --confirm-enum-drop`) | 3    | spec-enum-value-removal.md               |
| M3.C — Vite AST strip via Babel      | `@forinda/kickjs-vite` Babel pass + golden fixtures + perf check                                     | 3    | none                                     |

**Total:** ~3 weeks sequential, ~10 days with M3.A and M3.B/C in parallel.

---

## Priority rationale

**M3.A first** — biggest adopter pull. Every existing competitor (Drizzle / Prisma / MikroORM / TypeORM) ships single-trip relational reads; `task-kickdb-api` currently does N+1 selects when joining `tasks → assignees → users`. This is the gap that keeps the example app from being a strict drop-in for `task-prisma-api`.

**M3.B second** — correctness gap. Today `pgEnum` round-trip drops a value into a `-- comment` and silently no-ops, which means `kick db generate` produces migrations that **silently lose information** if an adopter removes a value mid-list. Cheap to fix, expensive to leave.

**M3.C last** — pure DX win, no correctness risk. Adopters get a smaller prod bundle when they wire DevTools tabs into their app, but nothing breaks today. Land it once the more impactful work is in.

---

## File structure

New files this plan adds:

```
docs/db/
  spec-relational-query.md            M3.A — sub-spec, written before code
  spec-enum-value-removal.md          M3.B — sub-spec

packages/db/src/
  query/                              M3.A
    types.ts                            relational query types + `with` clause inference
    builder.ts                          `db.query.X.findMany({ with })` runtime
    compile-pg.ts                       PG: nested SELECT + json_agg
    compile-sqlite.ts                   SQLite: json_group_array (placeholder for M4)
  emit/
    pg-enum-drop.ts                   M3.B — `ALTER TYPE … RENAME` + recreate dance

packages/db/__tests__/
  unit/
    query-types.test-d.ts             M3.A — expectTypeOf for `with` shape
    query-compile.test.ts             M3.A — snapshot SQL output
    enum-drop-value.test.ts           M3.B — diff/invert/emit round trip
  integration/
    relational-query.test.ts          M3.A — Testcontainers PG, real `json_agg`
    enum-drop-value.test.ts           M3.B — Testcontainers PG, lossy column flow

packages/vite/src/
  babel-strip-devtools.ts             M3.C — `@babel/core` transform
  __tests__/
    babel-strip-devtools.test.ts      M3.C — golden fixtures
```

---

## Conventions

- Same as M2. New: each compile-X module exports `compile(query, schema): { sql, parameters }` so the runtime stays dialect-agnostic. No leaking dialect names into `packages/db/src/query/builder.ts`.
- New `kick db migrate` flag: `--confirm-enum-drop`. Without it, removed-enum migrations refuse to apply with a `MigrationDriftError`. With it, the runner runs the rename-recreate dance.

---

## M3.A — `db.query.X.findMany({ with })` relational layer

**Story:** architecture §6 (Layer 3). Reserved slot in M2 plan T18. The spec lives at `docs/db/spec-relational-query.md` (write first).

### Step A.1 — Write the sub-spec ✅ (2026-05-05)

- [x] Lock the type shape:
  ```ts
  db.query.users.findMany({
    with: {
      posts: { with: { comments: true } },
      profile: true,
    },
  })
  // returns User[] where each user has `posts: (Post & { comments: Comment[] })[]` and `profile: Profile | null`
  ```
- [x] Lock the SQL strategy per dialect. For PG: nested SELECT in `LATERAL` + `json_agg(row_to_json(…))`. Document the ordering / null-aggregation edge cases.
- [x] Lock the relations contribution: `relations()` in `packages/db/src/dsl/relations.ts` already declares `one`/`many` shapes; the query layer reads from the same registry without rebuilding it.
- [x] Reviewer sign-off (file under `docs/db/`, no GitHub PR yet).

### Step A.2 — Types ✅ (2026-05-05)

- [x] `packages/db/src/query/types.ts` — `FindManyOptions<Table>` + `FindManyRow<Table, Opts>` + `KickDbRelationsRegister` augmentable registry + `QueryNamespace` / `TableQueryNamespace`.
- [x] `expectTypeOf` cases in `packages/db/__tests__/unit/query-types.test.ts` covering: 1-deep `many`, 1-deep `one`, 2-deep `many→many`, 2-deep `many→one`, 2-deep `one→many`, boolean shorthand, nested options, self-reference, cycle, bare `findMany`, empty `with`, unknown-key `@ts-expect-error`, known-key, target-shape canary. **14 tests, all passing.**

### Step A.3 — PG compiler ✅ (2026-05-05)

- [x] `packages/db/src/query/compile-pg.ts` — pure `(db, table, options, relations, mode) → CompiledQuery`. Uses Kysely's `jsonArrayFrom` / `jsonObjectFrom` from `kysely/helpers/postgres`. `where` / `orderBy` callbacks bridged via a Proxy-backed table-ref to keep the `(table, ops) => Expression` signature working.
- [x] `packages/db/src/query/relations.ts` — `ResolvedRelation` + `ResolvedRelations` sidecar shape consumed by the compiler. Populated from `extractSnapshot` in A.4.
- [x] `packages/db/src/query/errors.ts` — `RelationalQueryUnknownRelationError`, `RelationalQueryDepthError`, `RelationalQueryAliasCollisionError`, `RelationalQueryNotSupportedError`.
- [x] `packages/db/__tests__/unit/query-compile.test.ts` — 16 fixtures: bare findMany, 1-deep many, 1-deep one, 2-deep many→many, 2-deep one→many, self-ref grandchild, per-relation where/limit, outer where/orderBy/limit/offset, `first` + `unique` modes, explicit-limit override, unknown-key throw, depth-1 throw, max-5 accept, depth-6 throw. **All 16 passing.**
- [x] Full db suite green: **49 files, 275 tests** (was 259 pre-A.3 → +16 from this step). Typecheck clean.

### Step A.4 — Runtime ✅ (2026-05-05)

- [x] `packages/db/src/query/extract-relations.ts` — resolves `relations()` declarations into the JSON-serializable sidecar. `one` straight from `fields/references`; `many` via inverse `one` lookup, then FK introspection fallback (preserves M0/M1 schemas that declare `many` only). Throws `RelationalQueryAliasCollisionError` on column-name shadow + `RelationalQueryMissingInverseError` when neither inverse nor FK can resolve.
- [x] `packages/db/src/snapshot/types.ts` — added optional `relations?: Record<string, Record<string, RelationSnapshot>>` to `SchemaSnapshot`. JSON-serializable; migration pipeline ignores.
- [x] `packages/db/src/snapshot/extract.ts` — `extractSnapshot` now populates the relations sidecar via `extractRelations`. Absent when no relations are declared (no shape change for callers that skip the query layer).
- [x] `packages/db/src/query/compilers.ts` — `pickCompiler(dialect)` returns `compilePg` for postgres, throw-stub for sqlite/mysql.
- [x] `packages/db/src/query/builder.ts` — `buildQueryNamespace(qb, relations, compile)` returns a Proxy-based `QueryNamespace<DB>`. Each method calls the compiler then `qb.executeQuery(compiled)`, returning rows.
- [x] `packages/db/src/client/types.ts` — `KickDbClient<DB>.query: QueryNamespace<DB>` is now a public field.
- [x] `packages/db/src/client/wrap.ts` — `InternalContext.query = { relations, compile }` threads through; `wrap()` attaches `query` automatically (works inside transactions + savepoints + `$extends` re-wraps).
- [x] `packages/db/src/client/create.ts` — calls `extractSnapshot` once at boot to resolve relations, picks the dialect compiler, populates the InternalContext. `detectDialect` now also inspects the adapter class so hand-rolled `KyselyDialect` literals (used by tests) are recognized correctly.
- [x] `packages/db/src/index.ts` — re-exports public surface: `FindManyOptions`, `FindManyRow`, `WithClause`, `KickDbRelationsRegister`, `RegisteredRelations`, `RelationMapEntry`, `TableRelations`, `QueryNamespace`, `TableQueryNamespace`, `ResolvedRelation`, `ResolvedRelations`, `RelationSnapshot`, plus the four error classes.
- [x] `packages/db/__tests__/unit/extract-relations.test.ts` — 8 tests: resolve `one`, resolve `many` via inverse, FK fallback, missing-inverse error, alias-collision error, undefined-when-empty, sidecar wired into snapshot, self-reference. **All passing.**
- [x] `packages/db/__tests__/unit/query-builder.test.ts` — 8 end-to-end tests via `createDbClient` + `DummyDriver`: PG happy paths (findMany / findMany-with-with / findFirst / findFirst-empty / findUnique / Proxy materialization) + SQLite + MySQL throw-paths. **All passing.**
- [x] Full db suite: **51 files, 292 passing** (+17 vs pre-A.4 baseline). db-pg suite green at 17. Build clean.

### Step A.5 — Integration

- [ ] `packages/db/__tests__/integration/relational-query.test.ts` — Testcontainers PG, asserts row shape parity with the equivalent hand-written nested SELECT.
- [ ] Update `examples/task-kickdb-api` to use `db.query.tasks.findMany({ with: { assignees: true, labels: true } })` in at least one repository method. Confirm the shipped API is ergonomic, not just typesafe.

### Step A.6 — Commit + changeset

```bash
pnpm changeset
# minor bump on @forinda/kickjs-db
git commit -m "feat(db): db.query.X.findMany({ with }) relational layer (M3.A)"
```

---

## M3.B — Removed-enum-value handling

**Story:** Today `packages/db/src/emit/pg.ts:63` emits a comment and skips. `packages/db/src/diff/invert.ts:66` flags this as ambiguous-reverse. Lossless round-trip requires the rename-recreate dance.

### Step B.1 — Write the sub-spec

- [ ] `docs/db/spec-enum-value-removal.md` — operator flow:
  1. `kick db generate` detects removed value, emits a migration with `-- KICK ENUM REMOVE` header + the rename-recreate SQL behind a `BEGIN; … COMMIT;` block.
  2. `kick db migrate` refuses to apply without `--confirm-enum-drop`. Errors with the list of columns that reference the value (introspect to find them).
  3. With the flag: PG runs `ALTER TYPE foo RENAME TO foo__old` → `CREATE TYPE foo AS ENUM (…)` → `ALTER TABLE … ALTER COLUMN … TYPE foo USING value::text::foo` → `DROP TYPE foo__old`.
- [ ] Decide whether `kick db migrate down` rolls this back. (Probably no — recreating the dropped value is fine, but rebuilding the column TYPE back is not free, and rollback in M2 explicitly preserves data.) Document the decision in the spec.

### Step B.2 — Diff + invert

- [ ] `packages/db/src/diff/engine.ts` — emit a structured `EnumValueRemoved` change instead of the current comment.
- [ ] `packages/db/src/diff/invert.ts` — invert to `EnumValueAdded` (no rename-recreate on rollback per spec decision above).

### Step B.3 — Emit

- [ ] `packages/db/src/emit/pg-enum-drop.ts` — module exporting `emitEnumValueRemoved(change, schema): SqlBlock`.
- [ ] Wire into `packages/db/src/emit/pg.ts` — replace the silent no-op block with the new call.

### Step B.4 — Runner

- [ ] `packages/db/src/migrate/runner.ts` — detect `-- KICK ENUM REMOVE` header in the migration SQL, refuse to run without `confirmEnumDrop: true` in `RunnerOptions`.
- [ ] `packages/cli/src/commands/db.ts` — pass `--confirm-enum-drop` flag through.

### Step B.5 — Tests

- [ ] Unit: `packages/db/__tests__/unit/enum-drop-value.test.ts` — diff + emit produces expected SQL.
- [ ] Integration: `packages/db/__tests__/integration/enum-drop-value.test.ts` — Testcontainers PG, full round trip with a real column on the affected enum.

### Step B.6 — Commit + changeset

```bash
pnpm changeset
# patch bump on @forinda/kickjs-db (behavior fix, no API surface change beyond the flag)
git commit -m "fix(db): lossless enum-value removal with --confirm-enum-drop (M3.B)"
```

---

## M3.C — Vite AST strip via Babel

**Story:** M2 plan T15. Today `packages/vite/src/devtools-flag-plugin.ts:6` uses regex-based stripping; the comment explicitly notes "without a babel pass." Adopters who wire custom DevTools tabs ship the dev-only render code into prod.

### Step C.1 — Implementation

- [ ] `packages/vite/src/babel-strip-devtools.ts` — `@babel/core` transform plugin that walks the program and strips:
  - Calls to `defineDevtoolsRenderTab` / `defineDevtoolsTab`
  - Imports of `@forinda/kickjs-devtools-kit` and its sub-paths (`/bus`, `/runtime`)
  - The augmentation file `*/devtools-events.ts` (already a side-effect import; safe to drop in prod)
- [ ] Add `@babel/core` + `@babel/plugin-transform-typescript` to `packages/vite/package.json` as **dependencies** (not peer — adopters do not configure Babel themselves).

### Step C.2 — Wire

- [ ] `packages/vite/src/index.ts` — replace the regex strip in `devtools-flag-plugin.ts` with the Babel pass when `mode === 'production'`. Keep regex path as the dev fast-path.

### Step C.3 — Tests

- [ ] `packages/vite/src/__tests__/babel-strip-devtools.test.ts` — golden fixtures: input source → expected stripped output. Cover: render-tab definition, side-effect import, conditional import.
- [ ] Bundle-size assertion: build the `examples/task-kickdb-api` prod bundle with + without the strip, assert >= 30KB delta. (Devtools-kit is ~50KB minified.)

### Step C.4 — Commit + changeset

```bash
pnpm changeset
# patch bump on @forinda/kickjs-vite
git commit -m "feat(vite): Babel-based devtools strip for prod bundles (M3.C)"
```

---

## M3 exit gate

- [ ] `pnpm test` green across the monorepo.
- [ ] `pnpm build` green; bundle-size assertions pass.
- [ ] `examples/task-kickdb-api` uses `db.query.tasks.findMany({ with })` in at least one repository method.
- [ ] `m2-release.md` "Out of scope" list deleted (or moved to `m3-release.md`).
- [ ] `m3-release.md` written summarizing the three landings and any follow-up backlog.

---

## Plan self-review notes

- **Why no M3.D?** No platform-wide work this milestone. The KickEventBus + typegen plugin substrate from M2 covered the cross-cutting story; M3 is three focused, independent improvements.
- **Why is M3.A so much bigger than M3.B+C combined?** Relational query compilation across dialects has a non-trivial design surface (LATERAL vs subquery vs CTE per dialect; ordering; null-aggregation; cycles). The 8–10 day estimate assumes the spec lands clean on the first pass; if dialect parity becomes contentious, treat the SQLite/MySQL compilers as optional and ship PG-only behind a feature flag.
- **Why not bundle these into M2 patches?** M3.A is a minor bump (new public surface). The cadence is intentionally separated so adopters get a clean "v5.3 = relational queries" mental model.
