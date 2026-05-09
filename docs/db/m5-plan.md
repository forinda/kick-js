# M5 — Plan: DEFAULT fix + AbortSignal + KickDbClient narrowing + ALTER TYPE refactor

> **Status (2026-05-09):** Draft. Tracks the one carry-over from M4 ([`m4-release.md`](./m4-release.md) "Surfaced gaps") plus three additive deliverables unblocked by the Kysely 0.29 bump that landed in `@forinda/kickjs-db@5.6.0`. Once these ship, the relational query layer + migration runner stop having any "this works except…" caveat in their adopter-facing docs.

**Goal:** Close the column-DEFAULT preservation gap surfaced by M4.E.1's integration test, thread `AbortSignal` through `db.query.*` so request-scoped cancellation works end-to-end, and surface Kysely 0.29's `$pickTables` / `$omitTables` / `ReadonlyKysely` on `KickDbClient` so adopters can inject narrowed read-only handles without forking types.

**Architecture:** Three independent sub-milestones. M5.A is the bundled "quick wins" group — three small, additive deliverables that share a release. M5.B is an internal refactor on the emit path that opens space for future ALTER TYPE work without changing observable behaviour. M5.C is a new devtools render tab; lands behind the existing devtools-strip plugin so prod bundles stay clean.

**Tech stack:** Same as M4 — TypeScript, Vitest + SWC, tsdown, wireit, Kysely 0.29, Testcontainers PG. M5.B adds no runtime deps. M5.C reuses `@forinda/kickjs-devtools-kit`'s `defineDevtoolsRenderTab` + `KickEventBus`.

**Release discipline — patch + minor only, no majors in M5:** every sub-milestone ships as **patch or minor** on each affected package. **Any change that feels like it might warrant a major (new error class, removed field, changed default) gets demoted to minor for this cycle** — adopters absorbed too many majors during the M4 + Kysely-0.29 cycle and we owe them a stretch of additive-only releases. If a planned change can't fit inside minor semantics, it gets reshaped or moved to M6.

The `workspace:^` peer ranges (PR #207) plus `onlyUpdatePeerDependentsWhenOutOfRange: true` already prevent peer adapters from cascading to majors on a core minor bump. This rule extends the same discipline to the core package itself.

**Specs to write before code:**

- `docs/db/spec-default-preservation.md` — locks the `DROP/SET DEFAULT` bracket placement inside the rename-recreate dance + the snapshot fields the emitter reads. Short.
- `docs/db/spec-abortsignal-threading.md` — defines `signal` on `FindManyOptions` / `FindFirstOptions` / `FindUniqueOptions`, the precedence rule when both `signal` and a per-relation `signal` exist, and the dialect-level expectations for cancellation (PG `pg_cancel_backend`, SQLite synchronous, MySQL `KILL QUERY`).
- No spec for M5.A.3 (`$pickTables` re-export) or M5.B (refactor) — pure type-surface / internal moves.

**Prereq:** v5.6 published (done 2026-05-09), kysely 0.29 in place.

---

## Estimated cadence

| Sub-milestone                                     | Scope                                                                                                                      | Days | Blockers                                          |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ---- | ------------------------------------------------- |
| M5.A.1 — DEFAULT preservation                     | Spec + `emit/pg.ts` DROP/SET DEFAULT brackets + snapshot field plumb + Testcontainers integration update                   | 2    | spec-default-preservation.md                      |
| M5.A.2 — AbortSignal threading                    | Spec + `FindManyOptions.signal` + `executeQuery({ signal })` plumb + per-dialect cancellation tests                        | 2–3  | spec-abortsignal-threading.md                     |
| M5.A.3 — KickDbClient narrowing helpers           | Re-export `$pickTables` / `$omitTables` / `ReadonlyKysely` from `@forinda/kickjs-db` + adopter doc paragraph               | 0.5  | none                                              |
| M5.B — ALTER TYPE node refactor + null-cmp plugin | Replace string emit with Kysely's ALTER TYPE node + ship `safeNullComparison` opt-in on `KickDbClientOptions`              | 2.5  | M5.A.1 done (DEFAULT fix lives in same emit path) |
| M5.C — Connection-pool devtools tab               | New `defineDevtoolsRenderTab` consuming `db:query`, `db:slow-query`, `db:query-error` events; live-update via KickEventBus | 4    | none                                              |

**Total:** ~11 days sequential, ~7 days with M5.A.2/A.3 + M5.C running parallel to M5.A.1/B.

---

## Priority rationale

**M5.A first** — three small wins that each justify their own release line. DEFAULT preservation fixes a real adopter pain (the M4.E.1 fixture works around it but real schemas can't). AbortSignal closes a request-cancellation gap that's been latent since `RequestContext.signal` shipped — adopters today have to wrap every query in a `try/finally` to short-circuit. The `$pickTables` re-export is a five-minute change with high DX value.

**M5.B** — keeps the M5.A.1 emit refactor honest. The DEFAULT fix lives inside `emitRemoveEnumValueRecreate`; replacing the hand-rolled string with Kysely's ALTER TYPE node before/during that fix avoids ratcheting the string format twice. The SafeNullComparisonPlugin opt-in lands in the same release because they're both "Kysely 0.29 surface" — bundles cleanly.

**M5.C** — pure DX, zero correctness implications. Doesn't block other work; can move to M6 if a higher-priority item surfaces.

---

## File structure

New files this plan adds:

```
docs/db/
  spec-default-preservation.md          M5.A.1 — DROP/SET DEFAULT bracket placement
  spec-abortsignal-threading.md         M5.A.2 — signal precedence + dialect cancellation
  m5-release.md                         closing — written when the four sub-milestones ship

packages/db/src/
  emit/
    alter-type.ts                       M5.B — typed ALTER TYPE node helpers
  client/
    plugins.ts                          M5.B — built-in plugin registry incl. safeNullComparison

packages/db/__tests__/
  unit/
    default-preservation.test.ts        M5.A.1 — emit/snapshot round-trip with DEFAULTs
    abort-signal-unit.test.ts           M5.A.2 — signal threading on the compile path
    pick-tables-types.test.ts           M5.A.3 — type-only assertions for narrowed clients
    safe-null-comparison.test.ts        M5.B — opt-in plugin behaviour
  integration/
    enum-drop-with-default.test.ts      M5.A.1 — extends M4.E.1's lifecycle with DEFAULTs

packages/db-pg/__tests__/integration/
  abort-signal-pg.test.ts               M5.A.2 — pg_cancel_backend round trip

packages/db-sqlite/__tests__/integration/
  abort-signal-sqlite.test.ts           M5.A.2 — synchronous cancellation

packages/db-mysql/__tests__/integration/
  abort-signal-mysql.test.ts            M5.A.2 — KILL QUERY round trip

packages/devtools/spa/src/tabs/
  db-pool/                              M5.C — new tab; query log + pool stats UI
    index.ts
    query-log.tsx
    pool-stats.tsx
```

---

## Conventions

- **Semver discipline (loud rule):** every sub-milestone ships as patch or minor — no majors in M5, full stop. If reviewing a changeset feels like "this should be major," reshape the change to fit minor semantics (additive surface, opt-in default, deprecation path instead of removal) or push it to M6. M5.A.1 is `patch` on `@forinda/kickjs-db` (correctness fix). M5.A.2 + M5.A.3 are each `minor` (additive). M5.B is `minor` (new opt-in plugin) + internal patch on the emit refactor. M5.C is `minor` on `@forinda/kickjs-db` (new event payloads, if any) + `minor` on `@forinda/kickjs-devtools` (new tab).
- **Spec-first:** M5.A.1 + M5.A.2 each get a sub-spec under `docs/db/` before code. Internal-only items (M5.A.3, M5.B refactor) skip the spec — the implementation is the spec.
- **Test-first for adopter-visible changes:** M5.A.2's integration tests live in the dialect-specific peer packages (matches the M4.A pattern). The unit-level signal threading test lives in `packages/db/`.
- **No new public surface beyond the listed APIs:** any incidental Kysely 0.29 wins (e.g. `eb.case().thenRef`) ride along through the existing client without new wrappers — adopters reach for them via the standard `qb` accessor.

---

## M5.A — Quick wins bundle

Three small, additive deliverables that ship together as one release. Each gets its own changeset entry so the changelog stays scannable.

### M5.A.1 — Column DEFAULT preservation across `pgEnum` rename-recreate

**Story:** [`m4-release.md`](./m4-release.md) "Surfaced gaps". The M3.B rename-recreate dance assumes the affected column doesn't carry a DEFAULT pointing at the old enum. PG refuses the `ALTER COLUMN TYPE … USING …` cast when a DEFAULT references the old type, returning `default for column X cannot be cast automatically`. The M4.E.1 integration test works around this by omitting the DEFAULT — real adopter schemas don't have that luxury.

#### Step A.1.1 — Sub-spec

- [ ] `docs/db/spec-default-preservation.md` — short. Documents the four-step bracket placement:
  1. `ALTER TABLE T ALTER COLUMN C DROP DEFAULT;` (per affected column)
  2. (existing) `ALTER TABLE T ALTER COLUMN C TYPE foo USING C::text::foo;`
  3. `ALTER TABLE T ALTER COLUMN C SET DEFAULT 'value'::foo;` (per affected column whose snapshot recorded a default)
  4. (existing) `DROP TYPE foo__old;`
- [ ] Document the snapshot field the emitter reads (`ColumnSnapshot.default` already exists; spec confirms it carries the literal SQL form).

#### Step A.1.2 — Snapshot plumb

- [ ] `packages/db/src/diff/types.ts` — `RemoveEnumValue.affectedColumns[i]` gains an optional `default: string | null` field.
- [ ] `packages/db/src/diff/engine.ts` — populate `default` when building the change from snapshot.

#### Step A.1.3 — Emit

- [ ] `packages/db/src/emit/pg.ts:emitRemoveEnumValueRecreate` — interleave DROP DEFAULT and SET DEFAULT brackets per the spec. Skip both when `default == null`.
- [ ] `packages/db/__tests__/unit/default-preservation.test.ts` — snapshot fixtures: column with literal default, column with no default, multiple columns mixed.
- [ ] `packages/db/__tests__/unit/emit-pg-columns.test.ts` — keep the existing assertions; assert the new DROP/SET ordering.

#### Step A.1.4 — Integration

- [ ] `packages/db/__tests__/integration/enum-drop-with-default.test.ts` (new) — Testcontainers PG. Schema with `DEFAULT 'active'`, removes `legacy`, asserts the rename-recreate succeeds + the DEFAULT survives the dance pointing at the new enum.

#### Step A.1.5 — Commit + changeset

```bash
pnpm changeset
# patch on @forinda/kickjs-db (correctness fix; no new public surface)
git commit -m "fix(db): preserve column DEFAULT through pgEnum rename-recreate (M5.A.1)"
```

---

### M5.A.2 — `AbortSignal` threading through `db.query.*`

**Story:** Kysely 0.29 ships `AbortableQueryOptions` on `executeQuery`. `RequestContext.signal` in kickjs-http already exists and fires on client disconnect / request timeout. Today adopters who want request-scoped query cancellation have to wrap every call site in a manual `Promise.race`; threading the signal natively closes that gap.

#### Step A.2.1 — Sub-spec

- [ ] `docs/db/spec-abortsignal-threading.md` — short. Defines:
  - `signal?: AbortSignal` on `FindManyOptions`, `FindFirstOptions`, `FindUniqueOptions`.
  - Per-relation `with: { posts: { signal } }` is invalid — child queries inherit the parent's signal (single signal per top-level call).
  - Cancellation strategy by dialect: PG → `pg_cancel_backend`, SQLite → synchronous abort (no in-flight cancel; the signal short-circuits before the next statement), MySQL → `KILL QUERY`.
  - When the signal fires, the function rejects with a new `RelationalQueryCancelledError` (extends `KickDbError`, code `relational_query_cancelled`).

#### Step A.2.2 — Type surface

- [ ] `packages/db/src/query/types.ts` — `signal?: AbortSignal` on the three options shapes.
- [ ] `packages/db/src/query/errors.ts` — new `RelationalQueryCancelledError`.

#### Step A.2.3 — Plumb

- [ ] `packages/db/src/query/builder.ts` — pass `{ signal }` to the underlying `executeQuery` call. Map `AbortError` (the rejection shape Kysely 0.29 throws) to `RelationalQueryCancelledError` so adopters see a consistent `KickDbError` instead of the generic browser-style abort.

#### Step A.2.4 — Tests

- [ ] `packages/db/__tests__/unit/abort-signal-unit.test.ts` — fake `executeQuery` that observes the `signal` arg; asserts pass-through. Covers all three find\* shapes + the with-clause inheritance rule.
- [ ] `packages/db-pg/__tests__/integration/abort-signal-pg.test.ts` — Testcontainers PG. `pg_sleep(10)` query with a signal aborted at 100ms; asserts `RelationalQueryCancelledError` + `pg_stat_activity` shows the backend cancelled.
- [ ] `packages/db-sqlite/__tests__/integration/abort-signal-sqlite.test.ts` — synchronous cancel; assert short-circuit before the next statement.
- [ ] `packages/db-mysql/__tests__/integration/abort-signal-mysql.test.ts` — Testcontainers MySQL 8. `SLEEP(10)` query, signal aborted, assert `KILL QUERY` + the cancellation error.

#### Step A.2.5 — Commit + changeset

```bash
pnpm changeset
# minor on @forinda/kickjs-db (additive — new options field + new error class)
git commit -m "feat(db): AbortSignal threading on db.query.* + RelationalQueryCancelledError (M5.A.2)"
```

---

### M5.A.3 — `KickDbClient` narrowing helpers

**Story:** Kysely 0.29 ships `$pickTables<...>()` / `$omitTables<...>()` / `ReadonlyKysely` for compile-time schema reduction. `KickDbClient` extends `Kysely<DB>` so these are technically reachable today via `client.$pickTables(...)`, but adopters who hit them through `KickDbClient` get no documentation and no obvious entry point.

#### Step A.3.1 — Re-export

- [ ] `packages/db/src/index.ts` — re-export `ReadonlyKysely` as a named type alias on `@forinda/kickjs-db`. `$pickTables` / `$omitTables` are methods on the client itself; nothing to re-export — but the type alias surfaces them in IDE autocomplete on the bare-import path.

#### Step A.3.2 — Adopter doc

- [ ] `docs/guide/db-relational-query.md` — append a "Narrowing the client" section:
  ```ts
  // In a read-only repo:
  @Service()
  export class WorkspacesQueryRepository {
    constructor(@Inject(DB_PRIMARY) private readonly db: ReadonlyKysely<KickDb>) {}
    list() {
      return this.db.selectFrom('workspaces').selectAll().execute()
    }
    // this.db.insertInto(...) → compile error: Property does not exist on ReadonlyKysely
  }
  ```
- [ ] Cross-link to `docs/guide/db-schema-types.md` so adopters see how `KickDb` derives from the schema.

#### Step A.3.3 — Type-only test

- [ ] `packages/db/__tests__/unit/pick-tables-types.test.ts` — `expectTypeOf` assertions: `$pickTables<'users'>()` narrows `db.selectFrom` to `'users'` only; `ReadonlyKysely` is missing `insertInto` / `updateTable` / `deleteFrom` / `mergeInto`.

#### Step A.3.4 — Commit + changeset

```bash
pnpm changeset
# minor on @forinda/kickjs-db (additive — re-exported type alias + docs)
git commit -m "feat(db): re-export ReadonlyKysely + document \$pickTables/\$omitTables (M5.A.3)"
```

---

## M5.B — ALTER TYPE node refactor + `safeNullComparison` opt-in

**Story:** Two pieces of internal/Kysely-0.29 work that bundle cleanly into one release. The ALTER TYPE refactor swaps the hand-rolled string emit in `emitRemoveEnumValueRecreate` for Kysely's typed node — no observable change for adopters, but it consolidates the emit path so the M5.A.1 DEFAULT fix and any future enum-related work share one source of truth. The `safeNullComparison` opt-in surfaces Kysely's `SafeNullComparisonPlugin` as a `KickDbClientOptions` toggle so adopters who write `eb('foo', '=', null)` get the correct `IS NULL` instead of the silently-false `= NULL`.

### Step B.1 — ALTER TYPE node helpers

- [ ] `packages/db/src/emit/alter-type.ts` (new) — thin helpers that build Kysely's ALTER TYPE node form for `RENAME TO`, `ADD VALUE`, `RENAME VALUE`. Pure functions; testable without a DB connection.
- [ ] `packages/db/src/emit/pg.ts` — refactor `emitRemoveEnumValueRecreate` + `emitAddEnumValue` to use the new helpers. Output SQL must be byte-identical to today; lock that with the existing snapshot tests.
- [ ] `packages/db/__tests__/unit/emit-pg-columns.test.ts` — re-record snapshots only if the byte-identical claim breaks; otherwise the existing tests gate the refactor.

### Step B.2 — `safeNullComparison` opt-in

- [ ] `packages/db/src/client/plugins.ts` (new) — exports `safeNullComparison()` returning Kysely's `SafeNullComparisonPlugin` instance. Adopters add it via `KickDbClientOptions.plugins`.
- [ ] `packages/db/src/client/types.ts` — extend the existing `plugins?: KyselyPlugin[]` field type docstring with a pointer at the new helper.
- [ ] `packages/db/__tests__/unit/safe-null-comparison.test.ts` — fixtures: `eb('foo', '=', null)` compiles to `IS NULL` when the plugin is active; `= NULL` (broken default) without it. Lock both shapes.

### Step B.3 — Commit + changeset

```bash
pnpm changeset
# minor on @forinda/kickjs-db (new opt-in plugin helper) — the ALTER TYPE refactor is internal
git commit -m "feat(db): ALTER TYPE node refactor + safeNullComparison plugin opt-in (M5.B)"
```

No changeset on the peer adapters — `workspace:^` keeps them out of the cascade now that the range fix from PR #207 is in.

---

## M5.C — Connection-pool devtools tab

**Story:** `db:query`, `db:slow-query`, `db:query-error` events already publish to the KickEventBus (M2.D-T14). No first-party UI consumes them — adopters either subscribe manually in dev or rely on stdout logs. A devtools-render tab closes the loop: live query log with timing histograms, pool checkout latency, slow-query offenders bucketed by table.

### Step C.1 — Tab module

- [ ] `packages/devtools/spa/src/tabs/db-pool/index.ts` — `defineDevtoolsRenderTab({ id: 'kick:db-pool', title: 'DB', render: ... })`. Subscribes to the three events on mount; debounces UI updates at 30 fps.
- [ ] `packages/devtools/spa/src/tabs/db-pool/query-log.tsx` — virtualised list (last N events; configurable, default 500), each row showing duration + SQL + bound params (truncated).
- [ ] `packages/devtools/spa/src/tabs/db-pool/pool-stats.tsx` — pool checkout-time histogram + total queries / errors / slow counts.

### Step C.2 — Build wiring

- [ ] `packages/devtools/spa/src/tabs/index.ts` — register the new tab. Confirm the existing devtools-strip plugin removes the import + tab definition from prod bundles (M4.D's bundle-size assertion gates it).
- [ ] `scripts/bundle-size-check.ts` — re-run; the floor should still pass with comfortable margin (current 7.40 KB delta has plenty of room for the new tab's strip target).

### Step C.3 — Tests

- [ ] `packages/devtools/spa/__tests__/db-pool-tab.test.tsx` — Testing Library renders the tab against a fake bus that emits a small batch of events; asserts the log + histogram update.
- [ ] No DB-side test — the tab consumes existing events via the existing bus; the upstream side has its own coverage in `packages/db/__tests__/unit/devtools-bus-publish.test.ts`.

### Step C.4 — Commit + changeset

```bash
pnpm changeset
# minor on @forinda/kickjs-devtools
git commit -m "feat(devtools): connection-pool live query log + pool stats tab (M5.C)"
```

No changeset on `@forinda/kickjs-db` — it ships no new events for this; it's a UI consumer only.

---

## Major-shaped changes (audit)

Each item below was screened against the no-major rule. None require a major in their current shape.

| Change                                                | Major-shaped?                                                                              | Adopted shape  |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------ | -------------- |
| New `RelationalQueryCancelledError` (M5.A.2)          | No — additive error class                                                                  | minor          |
| `signal?: AbortSignal` on `FindManyOptions` (M5.A.2)  | No — optional field                                                                        | minor          |
| `safeNullComparison()` plugin (M5.B)                  | No — opt-in via `KickDbClientOptions.plugins`                                              | minor          |
| ALTER TYPE node refactor (M5.B)                       | No — output SQL byte-identical, locked by snapshot tests                                   | internal patch |
| DROP/SET DEFAULT brackets in rename-recreate (M5.A.1) | No — emitted only when snapshot records a default; existing migrations stay byte-identical | patch          |
| `ReadonlyKysely` re-export (M5.A.3)                   | No — type alias                                                                            | minor          |
| Devtools DB tab (M5.C)                                | No — new tab, no removal                                                                   | minor          |

If a future M5 deliverable surfaces with major-shaped semantics (e.g. removing an export, changing a default), the surfacer reshapes or defers it — they don't request a major in the changeset.

---

## M5 exit gate

- [ ] `pnpm test` green across the monorepo (db + db-pg + db-sqlite + db-mysql + cli + devtools + vite + example).
- [ ] `pnpm build` green per package.
- [ ] `pnpm test:bundle-size` passes (the new devtools tab is stripped from prod; floor unchanged).
- [ ] `examples/task-kickdb-api` adds at least one repository method that takes `ctx.signal` and threads it through `db.query.*` (M5.A.2 demonstrability).
- [ ] `m5-release.md` written summarising the four landings + any v5.7 carry-overs.
- [ ] Adopter-facing release notes mention only minor + patch bumps across the db family — the `workspace:^` peer-range discipline holds.

---

## Plan self-review notes

- **Why M5.A.3 (`$pickTables` re-export) is its own sub-MS rather than a one-line tag-along on M5.A.2?** Two reasons: (1) it deserves its own changelog entry so adopters discover the narrowing helpers without reading the AbortSignal entry; (2) it ships in M5.A's release without depending on the spec sub-step that A.1 + A.2 both gate on, so it can land first and build momentum on the release line.
- **Why bundle the ALTER TYPE refactor with `safeNullComparison` instead of folding it into M5.A.1 (DEFAULT fix)?** The DEFAULT fix is a correctness ship (patch). Mixing an internal refactor into a patch invites scope creep on review. M5.B is the minor that justifies both the refactor + the new plugin helper.
- **Why no spec for M5.B?** The refactor is mechanical (Kysely's typed node replaces the hand-rolled string; output is byte-identical, locked by existing snapshot tests). The plugin opt-in is a one-line re-export. Either is too small to justify a separate spec doc.
- **Why M5.C uses `defineDevtoolsRenderTab` rather than the legacy `defineDevtoolsTab`?** Render tabs are the M2.C contract that the devtools UI speaks natively. Legacy tabs are kept for back-compat but new work goes through the render API.
- **Why no read-replica routing in M5?** That's an M6 conversation. `DB_REPLICA` exists but the runtime routing rule is a separate spec — needs a brainstorm on read-after-write semantics, sticky sessions, the failure mode when the replica lags. Too much surface for a quick-win cycle.
- **Why no MSSQL adapter in M5?** Same reason — adapter packages need their own integration matrix + adopter docs. The Kysely 0.29 MSSQL features (`datetime2`, IF EXISTS DROP COLUMN) make it cheaper, but it's still a 1–2 week build. Slot it into M6 alongside the read-replica work.
