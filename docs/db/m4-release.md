# M4 Release Notes — v5.4.x

**Theme:** close the "PG only" caveat on the relational query layer + harden the M3 deliverables under regression locks.

M4 ships in two waves. **M4.A + M4.B** landed in `v5.4.0` (SQLite + MySQL relational compilers, peer adapter packages, `relationName` for multi-FK disambiguation). **M4.C – M4.F** land in the next minor: composite-type gate at `kick db generate` time, bundle-size assertion harness, real-PG enum-drop integration test + Copilot regression locks, and the adopter guide for `db.query`.

By the end of M4, the only carry-over from the original "Out of scope" list ([`m3-release.md`](./m3-release.md)) is the column-DEFAULT preservation across `pgEnum` rename-recreate, surfaced by the new integration test and tracked separately.

## Adopter-facing wins

### SQLite + MySQL relational queries (M4.A)

`db.query.<table>.findMany({ with })` now ships compilers for all three dialects. PG keeps the M3 LATERAL + `json_agg` / `to_json` shape. SQLite uses `json_group_array(json_object(...))` for `many` and `json_object(...)` for `one`. MySQL 8+ uses `JSON_ARRAYAGG(JSON_OBJECT(...))` wrapped in `COALESCE(..., JSON_ARRAY())` so empty `many` always reads as `[]`.

Two new peer adapter packages: **`@forinda/kickjs-db-sqlite`** (better-sqlite3) and **`@forinda/kickjs-db-mysql`** (mysql2 + MySQL 8.0+ floor). Both mirror `@forinda/kickjs-db-pg`'s shape — adapter + dialect, integration tests run against Testcontainers MySQL / in-memory better-sqlite3.

The `RelationalQueryNotSupportedError` throw-stub is gone.

### Multi-FK relations via `relationName` (M4.B)

`relations()` accepts an optional `relationName: 'foo'` string on `one` / `many`:

```ts
export const messagesRelations = relations(messages, ({ one }) => ({
  sender: one(users, {
    fields: [messages.senderId],
    references: [users.id],
    relationName: 'sender',
  }),
  recipient: one(users, {
    fields: [messages.recipientId],
    references: [users.id],
    relationName: 'recipient',
  }),
}))
```

When two FKs target the same table, the resolver walks `relationName`-tagged candidates first. Without a name, ambiguous cases throw `RelationalQueryAmbiguousRelationNameError` at extract time with a concrete fix-up hint.

The kick/db typegen plugin carries `relationName` through to `KickDbRelationsRegister` so the registered keys stay typed.

### `pgEnum` value-removal gate against composite types (M4.C)

`kick db generate` now refuses to emit when the diff produces a `removeEnumValue` for an enum that's referenced by a PG composite type / array-of-composite. The `ALTER COLUMN TYPE … USING …` clause in the rename-recreate dance can't reach into composite fields, so without the gate the migration would fail opaquely at apply time. The new `CompositeEnumReferenceError` lists every offending `<composite>.<attribute>`.

Detection runs against the configured PG connection on the built-in `pgAdapter` path. Adopters using the `db.adapter` factory escape hatch get the helper exported from `@forinda/kickjs-db` (`detectCompositeReferences`, `CompositeQueryRunner`, `CompositeRef`) so they can wire it themselves.

### Adopter guide for `db.query` (M4.F)

[`docs/guide/db-relational-query.md`](../guide/db-relational-query.md) walks adopters through their first `findMany`, nested `with`, per-relation `where`/`orderBy`/`limit`, self-references, and dialect notes. It also documents migrating from N+1 controllers to single-round-trip repositories.

`task-kickdb-api`'s `WorkspacesRepository` ports `findFullById(id)` and `listOwnedByUser(userId)` to `db.query.workspaces.find{Unique,Many}` — joining alongside the existing `TasksRepository.findFullById` from M3. Three example call sites total now.

## Internal hardening

### Bundle-size assertion (M4.D)

`scripts/bundle-size-check.ts` builds a small fixture twice (with + without `kickjsVitePlugin({ devtools: false })`), sums dist bytes, asserts the strip-on bundle is at least 1 KB smaller. Wired as `pnpm test:bundle-size` and a new CI job that runs after `build` on every PR.

Current measurement: 7.40 KB delta (98.4%). The strip cleanly removes the entire devtools-kit chunk on the supported top-level call pattern. A regression on `babel-strip-devtools.ts` would surface as a sub-1 KB delta and fail the gate.

### Testcontainers enum-drop round trip (M4.E.1)

`packages/db-pg/__tests__/integration/enum-drop-value.test.ts` runs the M3.B `pgEnum` value-removal flow against a real Postgres 16 container. Five-step lifecycle: gate refusal → dead-row-rollback → post-update success. Verifies catalog state (`pg_enum.enumlabel`), runner state (`kick_migrations`), and that the `__old` shadow type is dropped on success.

### Copilot regression locks (M4.E.2)

`packages/db/__tests__/unit/self-ref-and-tx-regressions.test.ts` locks the two M3 PR-review fixes that the original tests don't fail-loud against:

- `compilePg` self-references emit depth-suffixed aliases (`tasks_0` / `tasks_1`) at every level. Bare unaliased `from "tasks"` clauses in nested LATERALs would silently resolve to the inner FROM and produce wrong joins.
- `emitPg` `removeEnumValue` does not emit explicit `BEGIN; … COMMIT;`. Nesting a transaction inside the runner's `applySqlInTx` outer transaction commits early on the inner `COMMIT` and breaks the runner's atomic-apply guarantee.

## Surfaced gaps tracked for future work

- **Column DEFAULT preservation across `pgEnum` rename-recreate.** The integration test (M4.E.1) documents the workaround inline (no DEFAULT on the column) and notes that `emitRemoveEnumValueRecreate` should grow DROP/SET DEFAULT brackets when `affectedColumns[i]` carries a default. Tracked as a follow-up minor.

## Out of scope (deferred to v5.5)

- DEFAULT preservation in the rename-recreate dance (above).
- Cross-dialect bundle-size measurement against real adopter apps. The current harness validates the strip plugin's transform; adopter-facing prod bundle measurement is a separate dashboard concern.

## Versions

- `@forinda/kickjs-db`: minor (composite gate + helper export, additive).
- `@forinda/kickjs-cli`: patch (CLI wiring for the gate, KickConfig.db block typing).
- `@forinda/kickjs-db-sqlite`, `@forinda/kickjs-db-mysql`: previously shipped at 0.x in `v5.4.0`.

## Numbers

- `@forinda/kickjs-db`: **365 tests** (was 199 at M2 cut, 306 at M3, 359 at M4.A).
- `@forinda/kickjs-db-pg`: **24 tests** including the new enum-drop lifecycle.
- `@forinda/kickjs-cli`: **276 tests**.
- Bundle size delta gate: **7.40 KB** (floor 1 KB).
