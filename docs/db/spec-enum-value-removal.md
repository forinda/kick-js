# Spec — Removed `pgEnum` value handling

> **Status:** Draft v1 — 2026-05-05. Sub-spec for [`m3-plan.md`](./m3-plan.md) §M3.B. Locks the migration-file shape, the operator CLI flow, and the runner gate before code lands.

**Owner:** kickjs-db maintainers
**Architecture parent:** [`architecture.md`](./architecture.md) §5 (Migration engine) + [`m2-release.md`](./m2-release.md) "Out of scope" item.
**Related code:** `packages/db/src/diff/types.ts` (`RemoveEnumValue`), `packages/db/src/emit/pg.ts:43` (today's advisory comment), `packages/db/src/migrate/runner.ts` (where the gate lands).

---

## 1. Problem

Today `kick db generate` emits a multi-line `--` comment when an adopter removes a value from a `pgEnum`. The migration runs cleanly and **silently loses the schema's intent** — the database keeps the old value list. Drift only surfaces on the next generate against the same target.

PostgreSQL has no `ALTER TYPE … DROP VALUE`, so a real round-trip requires the four-step rename-recreate dance:

1. `ALTER TYPE foo RENAME TO foo__old`
2. `CREATE TYPE foo AS ENUM (…new value list…)`
3. For every column whose type is `foo`: `ALTER TABLE … ALTER COLUMN … TYPE foo USING column::text::foo`
4. `DROP TYPE foo__old`

Step 3 fails loudly if any row holds a removed value — exactly the safety check the operator needs.

---

## 2. Goals

1. **Lossless round-trip** when a value is removed from `pgEnum(...)` and the operator has explicitly confirmed.
2. **No silent data loss** when the operator runs `kick db migrate` without confirmation — the runner must refuse.
3. **Migration files stay self-contained** — no out-of-band metadata. The header in the SQL itself is the gate signal.
4. **Down-migration is honest** — re-adding the value is cheap (`ALTER TYPE … ADD VALUE`); reversing the rename-recreate dance is not. The down direction restores the value to the type but does **not** revert column-data mappings (operator-driven).

## Non-goals

1. **Auto-mapping rows that hold a dropped value** to a replacement. Adopters write a hand-rolled migration before `kick db generate` for that.
2. **Cross-dialect parity.** SQLite + MySQL handle enum-value removal differently (no `pgEnum` to begin with). Out of scope here.
3. **Composite types** that reference the enum (PG records / arrays containing the enum). Detected and refused with a clearer error; full support deferred to M4+.

---

## 3. Migration file shape

`kick db generate` emits a single migration with this header at the top of `up.sql`:

```sql
-- KICK ENUM REMOVE
-- enum: task_priority
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

Header rules:

- The literal string `-- KICK ENUM REMOVE` on its own line is the runner's recognition signal. Case-sensitive, trimmed.
- Subsequent `-- key: value` lines (`enum:`, `removed:`, `columns:`) carry the diagnostic payload the runner echoes back when it refuses.
- The `BEGIN; … COMMIT;` block is **explicit in the SQL**, not delegated to the adapter's `applySqlInTx` wrapper. Reason: the runner refuses before the SQL ever reaches the adapter; the wrapper would never see it.
- `meta.json` carries `transaction: false` so the adapter doesn't double-wrap the explicit block.

## 4. Runner gate

`RunnerOptions` gains:

```ts
export interface RunnerOptions {
  // ...existing fields...
  /**
   * Allow migrations carrying the `-- KICK ENUM REMOVE` header to
   * apply. Default: false. CLI exposes via `--confirm-enum-drop`.
   * In adopter code, set to `true` only after reviewing the
   * column-USING clauses in the up.sql.
   */
  confirmEnumDrop?: boolean
}
```

Before `applyEntry` reads any SQL, a new `checkEnumDropGate(entry, opts)` reads `up.sql`, scans the first 64 lines for the header, and:

- No header → returns silently. Ordinary migration.
- Header present, `confirmEnumDrop: true` → logs an info line, returns.
- Header present, no flag → throws `MigrationEnumDropError` carrying the parsed `enum`, `removed`, `columns` fields. The runner prints the operator-facing message and stops before any DB write.

## 5. Down direction

`invertChanges` keeps the existing behavior for `removeEnumValue`: carry the change verbatim. The forward emitter and the inverse emitter render different SQL:

- **Forward (remove):** the rename-recreate block above.
- **Reverse (re-add):** `ALTER TYPE foo ADD VALUE 'unused'; ALTER TYPE foo ADD VALUE 'archived';` — value-only, no column round-trip. Adopters who depend on row data mapping back to the dropped value must hand-roll the down step.

The reverse migration **does not carry** the `-- KICK ENUM REMOVE` header — its operations are reversible and cheap, and gating them would add ceremony without safety value.

---

## 6. Edge cases

| Case                                              | Behavior                                                                                                                                                                                               |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Enum has no referencing columns in next snapshot  | Block reduces to `ALTER TYPE … RENAME` + `CREATE TYPE … AS ENUM` + `DROP TYPE …__old`. No `ALTER TABLE` step.                                                                                          |
| Multiple columns reference the enum               | One `ALTER TABLE … ALTER COLUMN … USING …` clause per column. Header lists all.                                                                                                                        |
| Column is nullable                                | `USING column::text::foo` propagates NULL. No special handling.                                                                                                                                        |
| Column has a default (`'low'::task_priority`)     | The `ALTER COLUMN TYPE` clause re-evaluates the default against the new type; if the default still exists, fine. If the default itself is being dropped, the diff carries an `alterColumn` change too. |
| Composite types reference the enum                | Detected via `pg_attribute` introspection at `kick db generate` time (M4+). For v1, advisory comment + refuse to emit.                                                                                 |
| Adopter removes an entire enum (not just a value) | Existing `dropEnum` path. No header, no gate. Drop is unambiguous.                                                                                                                                     |
| Multiple enums lose values in the same migration  | Multiple `BEGIN; … COMMIT;` blocks back-to-back, each with its own header section.                                                                                                                     |

---

## 7. CLI surface

```bash
kick db migrate latest                        # refuses if any pending migration carries the header
kick db migrate latest --confirm-enum-drop    # applies; logs the affected enums
kick db migrate up --confirm-enum-drop        # same gate on single-step apply
```

Down-direction commands (`migrate down`, `migrate rollback`) do **not** require the flag — the reverse SQL is always cheap.

---

## 8. Acceptance — exits the spec when

- [x] Reviewer sign-off on §3 file shape and §4 runner gate. _(Defaults accepted by user 2026-05-05.)_
- [x] Edge-case table covers every observed shape from `examples/task-kickdb-api`.
- [x] No outstanding "Todo" in this file.
- [x] `m3-plan.md` Step B.1 marked `[x]`.

Spec is locked. M3.B.2 (diff/invert) is the next session.

---

## 9. Changelog

| Date       | Author | Note           |
| ---------- | ------ | -------------- |
| 2026-05-05 | claude | Initial draft. |
