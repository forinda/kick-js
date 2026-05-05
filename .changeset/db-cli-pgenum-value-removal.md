---
'@forinda/kickjs-db': minor
'@forinda/kickjs-cli': minor
---

Lossless removal of `pgEnum` values. Previously `kick db generate` emitted a multi-line `--` comment for value removals and the migration ran cleanly with **silent data loss** — the database kept the old value list. The next `kick db generate` cycle would surface the drift, but never the actual removal.

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
