---
'@forinda/kickjs-db': patch
---

fix(db): preserve column DEFAULT through `pgEnum` rename-recreate (M5.A.1)

Adopters whose schemas declared `column.notNull().default('active')` on an enum-typed column couldn't run the M3.B value-removal flow — PG refused the `ALTER COLUMN TYPE … USING …` cast with `default for column X cannot be cast automatically`. Fix: `emitRemoveEnumValueRecreate` now wraps the type swap in `DROP DEFAULT` / `SET DEFAULT 'value'::"<enum>"` brackets when the affected column carries a default.

Columns without a default emit the bare swap — output is byte-identical to pre-M5.A.1, so existing applied migrations keep their journal hashes.

New `RemovedValueAsDefaultError` is raised at `kick db generate` time when the column's default is itself one of the values being removed (the SET DEFAULT step would fail anyway). The operator must update the column default in the schema before re-running generate.

Spec: [`docs/db/spec-default-preservation.md`](https://github.com/forinda/kick-js/blob/main/docs/db/spec-default-preservation.md). Integration test: `packages/db-pg/__tests__/integration/enum-drop-with-default.test.ts`.
