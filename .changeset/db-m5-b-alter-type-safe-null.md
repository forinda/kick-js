---
'@forinda/kickjs-db': minor
---

feat(db): ALTER TYPE typed-IR helpers + `safeNullComparison()` plugin opt-in (M5.B)

Two pieces of internal / Kysely-0.29-surface work bundled into one minor.

### M5.B.1 — typed-IR helpers for `ALTER TYPE`

The four PG `ALTER TYPE` shapes the migration emitter produces (`RENAME TO`, `ADD VALUE`, `ADD VALUE BEFORE/AFTER`, `RENAME VALUE`) now flow through a typed IR (`AlterTypeIr`) in `packages/db/src/emit/alter-type.ts` plus one renderer. Emitted SQL is byte-identical to pre-refactor output — existing snapshot tests + every adopter's `_journal.json` migration hash continue to lock the uppercase form. Kysely 0.29's `db.schema.alterType(...).compile().sql` emits lowercase keywords (`alter type "foo" rename to ...`), so the helpers model Kysely's `AlterTypeNode` shape but render via the local emitter rather than Kysely's `PostgresQueryCompiler`.

Future enum-related work (value-rename, schema-move) now has one source of truth instead of scattered string-builds across `emit/pg.ts`.

Internal helpers — not surfaced on the public `package.json` exports map. Tests reach them through the `@forinda/kickjs-db/emit/alter-type` vitest alias.

### M5.B.2 — `safeNullComparison()` plugin opt-in

```ts
import { createDbClient, safeNullComparison } from '@forinda/kickjs-db'

const db = createDbClient({
  schema,
  dialect: pgDialect({ pool }),
  plugins: [safeNullComparison()],
})

await db.selectFrom('users').where('deletedAt', '=', null).selectAll().execute()
// → SQL: select * from "users" where "deletedAt" is $1   (param: null)
```

Without the plugin, Kysely passes `null` through as a bound parameter — `"col" = $1` evaluates to UNKNOWN under three-valued logic, filtering every row including the ones you meant to match. The plugin rewrites the operator to `IS` / `IS NOT` at AST level so the binding behaves as `IS NULL` / `IS NOT NULL`.

`CreateDbClientOptions` gains an additive `plugins?: KyselyPlugin[]` field — adopter plugins append after the built-in chain (`CodecPlugin` for `customType` mappers, `ParseJSONResultsPlugin` for SQLite + MySQL JSON decoding). Unset = byte-identical chain to pre-M5.B clients.

### Tests

- 6 new unit cases in `packages/db/__tests__/unit/alter-type-helpers.test.ts` — covers the three IR builders + the `before` / `after` mutual-exclusion guard + identifier quoting.
- 5 new unit cases in `packages/db/__tests__/unit/safe-null-comparison.test.ts` — locks the broken-default shape (`= $1` / `!= $1`) and the corrected-plugin shape (`IS $1` / `IS NOT $1`); confirms non-null comparisons aren't touched.
- The existing pg-enum-pipeline + default-preservation snapshot tests continue to gate byte-identity of the ALTER TYPE refactor.

`@forinda/kickjs-db`: **397 tests** (was 386 at M5.A.3 cut). Additive — no breaking change. M5 "no major bumps" rule respected.
