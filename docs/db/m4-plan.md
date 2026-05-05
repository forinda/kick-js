# M4 — Plan: Cross-dialect parity + correctness polish

> **Status (2026-05-05):** Draft. Tracks the five carry-overs from M3's "Out of scope" list ([`m3-release.md`](./m3-release.md)) plus three small DX items surfaced during the M3 PR review. Once these ship, v5.4 closes the "PG only" caveat on the relational query layer and fills the remaining drizzle-parity gaps.

**Goal:** Bring SQLite + MySQL up to the relational-query parity bar PG hit in M3, tighten the `pgEnum` removal flow's edge cases, and lock the regressions Copilot caught on PR #178 with explicit fixtures so the next reviewer doesn't have to re-spot them.

**Architecture:** Six independent sub-milestones — they do not share state. M4.A and M4.B touch `packages/db/src/query/`; M4.C touches the migration emit/diff path; M4.D/E are tooling + tests; M4.F is adopter-facing. Same conventions as M3: phantom-typed surfaces, snapshot/diff/emit pipeline as the single source of truth for migrations, no Reflect-based introspection.

**Tech stack:** Same as M3 — TypeScript, Vitest + SWC, tsdown, wireit, Kysely, Testcontainers PG. M4.A adds `better-sqlite3` and `mysql2` as dev dependencies for integration tests. M4.D may add a tiny build-comparison script under `scripts/`.

**Specs to write before code:**

- `docs/db/spec-relational-query-other-dialects.md` — locks the SQLite (`json_group_array(json_object(...))`) and MySQL (`JSON_ARRAYAGG(JSON_OBJECT(...))`) aggregation strategies + the dialect-detection edge cases (PG-flavored MySQL, libSQL, neon-http) before code starts.
- `docs/db/spec-relation-name.md` — short. Documents the `relationName` resolution rule + where it slots into `extractRelations`'s precedence (declared inverse `one` → declared `relationName` match → FK introspection → throw).

**Prereq:** v5.3 published (done 2026-05-05).

---

## Estimated cadence

| Sub-milestone                               | Scope                                                                                                          | Days | Blockers                                     |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ---- | -------------------------------------------- |
| M4.A — SQLite + MySQL compilers             | Spec + `compile-sqlite.ts` + `compile-mysql.ts` + dialect picker + Testcontainers MySQL + better-sqlite3 tests | 8–10 | spec-relational-query-other-dialects.md      |
| M4.B — `relationName` multi-FK              | Optional `relationName` on `Helpers.one` / `Helpers.many` + resolver precedence + typegen extension            | 3    | spec-relation-name.md                        |
| M4.C — Composite-type detection for pgEnum  | `pg_attribute` introspection at generate time + refuse to emit on composite reference                          | 3    | none                                         |
| M4.D — Bundle-size assertion harness        | `scripts/bundle-size-check.ts` builds example with + without strip, asserts ≥30KB delta                        | 1    | none                                         |
| M4.E — Testcontainers enum-drop integration | Real-PG round trip: gate refuses without flag, applies with flag, rejects rows holding removed value           | 2    | none                                         |
| M4.F — Adopter docs + example expansion     | `docs/guide/db-relational-query.md` + 2–3 more `db.query.X` call sites in `task-kickdb-api`                    | 3    | M4.A complete (so docs cover all 3 dialects) |

**Total:** ~3 weeks sequential, ~10 days with M4.B/C/D/E running parallel to M4.A.

---

## Priority rationale

**M4.A first** — biggest adopter pull. v5.3 ships `db.query.X.findMany({ with })` with a clear "PG only, throws on SQLite/MySQL" caveat. Closing that gap is the single change that unlocks the relational-query layer for the rest of the dialect community. The interface is already shaped for it (M3.A.4's `pickCompiler`); M4.A just fills in the throw-stubs.

**M4.B second** — drizzle parity gap. When a table has more than one FK to the same target (`messages.senderId` + `messages.recipientId` both referencing `users`), the M3 inverse-lookup fallback fails because `findInverseOne` finds two candidates. Drizzle's symmetric `relationName: 'foo'` pattern disambiguates. Without it, adopters with multi-FK schemas hit `RelationalQueryMissingInverseError` at extract time and have no good workaround.

**M4.C** — correctness gap on a niche edge case. `pgEnum` referenced by a PG composite type / array column / domain causes the M3 rename-recreate to fail at PG (the `ALTER COLUMN TYPE … USING` clause can't reach into composite fields). Today the failure is opaque ("type X is being used by table Y"); detecting the case at generate time and refusing with a clear error is cheap.

**M4.D + M4.E** — tooling + tests, no public API change. M4.D was deferred from M3.C; M4.E was deferred from M3.B.

**M4.F** — depends on M4.A landing because the adopter guide should cover all three dialects in one pass.

---

## File structure

New files this plan adds:

```
docs/db/
  spec-relational-query-other-dialects.md   M4.A — dialect-specific strategies
  spec-relation-name.md                     M4.B — multi-FK disambiguation
  m4-release.md                             closing — written when sub-milestones ship

docs/guide/
  db-relational-query.md                    M4.F — adopter-facing recipes

packages/db/src/
  query/
    compile-sqlite.ts                       M4.A — `json_group_array` + `json_object`
    compile-mysql.ts                        M4.A — `JSON_ARRAYAGG` + `JSON_OBJECT`
  diff/
    composite-detect.ts                     M4.C — pg_attribute introspection helper

packages/db/__tests__/
  unit/
    query-compile-sqlite.test.ts            M4.A — snapshot SQL fixtures
    query-compile-mysql.test.ts             M4.A
    relation-name.test.ts                   M4.B — extract-relations precedence
    composite-detect.test.ts                M4.C
    self-ref-and-tx-regressions.test.ts     M4.E — locks the Copilot-caught bugs
  integration/
    enum-drop-value.test.ts                 M4.E — Testcontainers PG full round trip

packages/db-mysql/                          M4.A — peer-dialect adapter package
  package.json
  src/index.ts                              MysqlAdapter + mysqlDialect
  __tests__/integration/
    relational-query.test.ts                Testcontainers MySQL parity test

packages/db-sqlite/                         M4.A — peer-dialect adapter package
  package.json
  src/index.ts                              SqliteAdapter + sqliteDialect
  __tests__/integration/
    relational-query.test.ts                better-sqlite3 in-memory parity test

scripts/
  bundle-size-check.ts                      M4.D — example-app build-twice harness
```

---

## Conventions

- Same as M3. New: each non-PG dialect compiler exports `compile<Dialect>(qb, table, options, relations, mode): CompiledQuery` matching the `CompileFn` shape from M3.A.4. The dialect picker (`packages/db/src/query/compilers.ts`) extends to all three real impls; the throw-stub is removed.
- New peer dialect packages follow the `@forinda/kickjs-db-pg` template — adapter + dialect + integration tests live in their own package; the `@forinda/kickjs-db` core stays driver-agnostic.
- New `kick db generate` behavior: when `pgEnum` removal is detected against a schema that uses the enum inside a composite type, the generator **refuses to emit** with `CompositeEnumReferenceError` (a new public class). Adopters drop or restructure the composite first.

---

## M4.A — SQLite + MySQL relational query compilers

**Story:** [`m3-release.md`](./m3-release.md) "Out of scope" item #1. Reserved slot in M3 plan via the `RelationalQueryNotSupportedError` throw-stub; M4.A swaps the stub for real impls.

### Step A.1 — Write the sub-spec

- [ ] `docs/db/spec-relational-query-other-dialects.md` — lock per-dialect SQL strategy:
  - **SQLite:** `(SELECT json_group_array(json_object('col1', col1, ...)) FROM (...))` for `many`. `json_object(...)` (single row) wrapped in `IFNULL(..., NULL)` for `one`. No LATERAL — SQLite uses correlated subqueries.
  - **MySQL:** `(SELECT JSON_ARRAYAGG(JSON_OBJECT('col1', col1, ...)) FROM (...))` for `many`. `JSON_OBJECT(...)` for `one`. MySQL 8+ only (5.x doesn't have `JSON_ARRAYAGG`).
- [ ] Document the empty-set behavior per dialect: SQLite returns `'[]'` from `json_group_array` over zero rows (good); MySQL's `JSON_ARRAYAGG` returns `NULL` (needs `COALESCE`).
- [ ] Decide whether `kickjs-db-mysql` requires MySQL 8+ as a peer-dep floor. Yes, with version assertion at `mysqlAdapter()` time.

### Step A.2 — SQLite compiler

- [ ] `packages/db/src/query/compile-sqlite.ts` — pure compile function. Reuse Kysely's existing SQLite `json_group_array` helper if available; otherwise inline.
- [ ] `packages/db/__tests__/unit/query-compile-sqlite.test.ts` — 12+ snapshot fixtures mirroring `query-compile.test.ts` shape (bare findMany, 1-deep many/one, 2-deep, self-ref, per-relation where/limit, mode flags, error paths).

### Step A.3 — MySQL compiler

- [ ] `packages/db/src/query/compile-mysql.ts` — pure compile function. Lateral derived tables are MySQL 8.0.14+; gate on the runtime version assertion or fall back to correlated subqueries.
- [ ] `packages/db/__tests__/unit/query-compile-mysql.test.ts` — same fixture shape as SQLite.

### Step A.4 — Wire the picker

- [ ] `packages/db/src/query/compilers.ts` — `pickCompiler` returns `compileSqlite` for sqlite + `compileMysql` for mysql. Throw-stub deleted.
- [ ] `packages/db/__tests__/unit/query-builder.test.ts` — replace the SQLite/MySQL throw-paths with happy-path assertions.

### Step A.5 — Peer packages

- [ ] `packages/db-sqlite/` — `@forinda/kickjs-db-sqlite` adapter + dialect, modeled on `@forinda/kickjs-db-pg`. Uses `better-sqlite3`.
- [ ] `packages/db-mysql/` — `@forinda/kickjs-db-mysql` adapter + dialect. Uses `mysql2`.

### Step A.6 — Integration

- [ ] `packages/db-sqlite/__tests__/integration/relational-query.test.ts` — in-memory `better-sqlite3` round trip mirroring the PG test shape.
- [ ] `packages/db-mysql/__tests__/integration/relational-query.test.ts` — Testcontainers MySQL 8.

### Step A.7 — Commit + changeset

```bash
pnpm changeset
# minor bump on @forinda/kickjs-db
# new packages: @forinda/kickjs-db-sqlite, @forinda/kickjs-db-mysql at 0.0.0 (changeset assigns first version)
git commit -m "feat(db,db-sqlite,db-mysql): SQLite + MySQL relational query compilers (M4.A)"
```

---

## M4.B — `relationName` for multi-FK disambiguation

**Story:** drizzle parity gap surfaced in the M3.A research note. Today, when two tables share more than one FK to the same target, `extractRelations`'s FK fallback finds multiple candidates and `findInverseOne` may pick the wrong one.

### Step B.1 — Sub-spec

- [ ] `docs/db/spec-relation-name.md` — short. Resolution precedence:
  1. Both sides declare `relationName: 'foo'` matching → use those columns.
  2. Inverse `one` declared without `relationName` AND only one inverse exists → use it (M3 behavior).
  3. FK introspection finds exactly one match → use it (M3 fallback).
  4. Otherwise → `RelationalQueryMissingInverseError` with hint to add `relationName`.

### Step B.2 — DSL types

- [ ] `packages/db/src/dsl/relations.ts` — extend `Helpers.one` + `Helpers.many` with optional `relationName: string` in the third arg. Runtime stores it on the `RelationOne` / `RelationMany` shape.
- [ ] `RelationOne` + `RelationMany` types extended with `relationName?: string`.

### Step B.3 — Resolver

- [ ] `packages/db/src/query/extract-relations.ts` — `findInverseOne` walks `relationName`-tagged relations first; falls back to the existing single-match heuristic.
- [ ] `packages/db/__tests__/unit/relation-name.test.ts` — cases: matched names, mismatched names, ambiguous without names, ambiguous with one side missing the name.

### Step B.4 — Typegen

- [ ] `packages/db/src/query/schema-relations-types.ts` — `SchemaToRelationsRegister<S>` carries `relationName` through to the registry shape so adopters get type-checked names.
- [ ] `packages/cli/__tests__/typegen-db-plugin.test.ts` — assertion that the emitted output preserves `relationName`.

### Step B.5 — Commit + changeset

```bash
pnpm changeset
# minor bump on @forinda/kickjs-db (additive — opt-in)
git commit -m "feat(db): relationName for multi-FK relation disambiguation (M4.B)"
```

---

## M4.C — Composite-type detection for `pgEnum` removal

**Story:** today the rename-recreate dance assumes the enum is referenced only by table columns. PG composite types / arrays / domains containing the enum break the `ALTER COLUMN TYPE … USING column::text::foo` clause.

### Step C.1 — Detection helper

- [ ] `packages/db/src/diff/composite-detect.ts` — `detectCompositeReferences(adapter, enumName): Promise<CompositeRef[]>`. Queries `pg_attribute` + `pg_type` to find composite types whose attributes use the enum.
- [ ] `packages/db/__tests__/integration/composite-detect.test.ts` — Testcontainers PG, schema with a composite type referencing an enum, asserts detection.

### Step C.2 — Generate-time gate

- [ ] `packages/db/src/cli/generate.ts` — after detecting a `removeEnumValue` change, call `detectCompositeReferences`. If any references found, throw `CompositeEnumReferenceError` with the list.
- [ ] New error class `CompositeEnumReferenceError` extends `KickDbError`.

### Step C.3 — Commit + changeset

```bash
pnpm changeset
# patch bump on @forinda/kickjs-db (correctness fix; refusal vs silent failure at PG)
git commit -m "fix(db): refuse pgEnum value removal when composite types reference the enum (M4.C)"
```

---

## M4.D — Bundle-size assertion harness

**Story:** deferred from M3.C. Validates that the Babel devtools strip actually removes the kit from production bundles.

### Step D.1 — Script

- [ ] `scripts/bundle-size-check.ts` — builds `examples/task-kickdb-api` twice (with + without `devtoolsStripPlugin`), measures bundle delta, asserts ≥30KB.
- [ ] Wire into `pnpm test:bundle-size` script.

### Step D.2 — CI

- [ ] `.github/workflows/ci.yml` — gate the v5.3+ vite changes on the assertion. Optional; can run weekly instead.

### Step D.3 — Commit

```bash
git commit -m "test(vite): bundle-size assertion harness for devtools strip (M4.D)"
```

No changeset — pure test infra.

---

## M4.E — Testcontainers enum-drop + Copilot regression locks

**Story:** consolidated test work. Two pieces:

1. Real-PG integration test for the M3.B rename-recreate path (deferred from M3.B).
2. Explicit fixtures locking the Copilot-caught bugs (#2 self-ref aliasing, #5 BEGIN/COMMIT nesting) so future reviewers don't have to re-spot them.

### Step E.1 — Enum-drop integration

- [ ] `packages/db/__tests__/integration/enum-drop-value.test.ts` — Testcontainers PG, full lifecycle:
  1. Schema with referenced enum + seeded rows.
  2. Generate migration that removes a value.
  3. `kick db migrate latest` without `--confirm-enum-drop` → `MigrationEnumDropError`.
  4. `kick db migrate latest --confirm-enum-drop` with rows holding the removed value → cast fails, transaction rolls back, schema unchanged.
  5. Update rows off the dead value, then retry → succeeds.

### Step E.2 — Self-ref + tx regressions

- [ ] `packages/db/__tests__/unit/self-ref-and-tx-regressions.test.ts` — explicit assertions:
  - `compilePg` self-reference uses depth-suffixed aliases (locks the M3 PR review fix).
  - `emitPg` `removeEnumValue` does not emit `BEGIN;` / `COMMIT;` (locks the M3 PR review fix).

### Step E.3 — Commit

```bash
git commit -m "test(db): Testcontainers enum-drop round trip + Copilot regression locks (M4.E)"
```

No changeset — pure test infra.

---

## M4.F — Adopter docs + example app expansion

**Story:** v5.3 shipped the relational query layer but only one example call site (`TasksRepository.findFullById`). Adopters who want to use `db.query.X` across their app need a guide.

### Step F.1 — Adopter guide

- [ ] `docs/guide/db-relational-query.md` — walks from "first findMany" through "nested with" to "findUnique on a composite key" + dialect notes (PG/SQLite/MySQL once M4.A lands).

### Step F.2 — Example app expansion

- [ ] `examples/task-kickdb-api/src/modules/workspaces/workspaces.repository.ts:listForUser` — port to `db.query.workspaces.findMany({ with: { members, projects } })`.
- [ ] `examples/task-kickdb-api/src/modules/projects/projects.repository.ts:findFullById` — port to `db.query.projects.findUnique({ with: { tasks: { with: { assignees } } } })`.

### Step F.3 — Commit

```bash
git commit -m "docs(db,example): adopter guide for db.query + 2 more example call sites (M4.F)"
```

No changeset — docs + example only.

---

## M4 exit gate

- [ ] `pnpm test` green across the monorepo (db + db-pg + db-sqlite + db-mysql + cli + vite + example).
- [ ] `pnpm build` green per package.
- [ ] `pnpm test:bundle-size` passes (≥30KB delta on the example app).
- [ ] `examples/task-kickdb-api` uses `db.query.X` in at least 3 repository methods.
- [ ] `m4-release.md` written summarizing the six landings + any v5.5 carry-overs.

---

## Plan self-review notes

- **Why two new peer packages (`db-sqlite` + `db-mysql`)?** Mirrors `db-pg`. The core stays driver-agnostic; adopters install only the adapter they need. Bundlers don't pull `mysql2` into a SQLite-only app.
- **Why `relationName` is a separate sub-milestone vs folding into a future M3.C+?** Drizzle parity is a discrete adopter ask with a small surface; bundling it with the dialect compilers would muddy the changeset. Independent minor bump.
- **Why M4.D (bundle-size) is in M4 not in M3.C?** No example-app build harness existed at M3 cut. M4 is the right home — the harness then covers all M3.C + future devtools work.
- **Why the M4.E Copilot-regression locks aren't in v5.3.1?** Two reasons: (1) the M3 fixes already landed in v5.3.0 with the original assertions adapted; the new tests are belt-and-suspenders, not a backport. (2) Bundling them with M4.E's other integration test keeps the CI runtime budget on one PR.
- **Why no M4 platform-wide work?** Same as M3 — KickEventBus + typegen substrate from M2 + M3 cover the cross-cutting story. M4 is six focused improvements.
