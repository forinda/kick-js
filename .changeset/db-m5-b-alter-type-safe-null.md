---
'@forinda/kickjs-db': minor
'@forinda/kickjs-db-pg': patch
---

feat(db): ALTER TYPE typed-IR helpers + `plugins?` opt-in (M5.B)

Two pieces of internal / Kysely-0.29-surface work bundled into one minor.

### M5.B.1 — typed-IR helpers for `ALTER TYPE`

The four PG `ALTER TYPE` shapes the migration emitter produces (`RENAME TO`, `ADD VALUE`, `ADD VALUE BEFORE/AFTER`, `RENAME VALUE`) now flow through a typed IR (`AlterTypeIr`) in `packages/db/src/emit/alter-type.ts` plus one renderer. Emitted SQL is byte-identical to pre-refactor output — existing snapshot tests + every adopter's `_journal.json` migration hash continue to lock the uppercase form. Kysely 0.29's `db.schema.alterType(...).compile().sql` emits lowercase keywords (`alter type "foo" rename to ...`), so the helpers model Kysely's `AlterTypeNode` shape but render via the local emitter rather than Kysely's `PostgresQueryCompiler`.

Future enum-related work (value-rename, schema-move) now has one source of truth instead of scattered string-builds across `emit/pg.ts`.

Internal helpers — not surfaced on the public `package.json` exports map. Tests reach them through the `@forinda/kickjs-db/emit/alter-type` vitest alias.

### M5.B.2 — `plugins?: KyselyPlugin[]` option

`CreateDbClientOptions` gains an additive `plugins?: KyselyPlugin[]` field — adopter plugins append after the built-in chain (`CodecPlugin` for `customType` mappers, `ParseJSONResultsPlugin` for SQLite + MySQL JSON decoding). Unset = byte-identical chain to pre-M5.B clients.

```ts
import { createDbClient } from '@forinda/kickjs-db'
import { CamelCasePlugin } from 'kysely'

const db = createDbClient({
  schema,
  dialect: pgDialect({ pool }),
  plugins: [new CamelCasePlugin()],
})
```

**Heads-up — Kysely 0.29's `SafeNullComparisonPlugin` ships broken on PG.** Verified empirically against `postgres:16-alpine` on this PR. The plugin rewrites `=` / `!=` against literal `null` to `IS` / `IS NOT` but keeps the null as a parameterised `ValueNode`, producing `WHERE "col" IS $1` with `$1=null` — which PG rejects with `syntax error at or near "$1"`. The original `safeNullComparison()` wrapper we'd planned to ship in this minor was pulled for that reason (would surface a runtime error instead of the silently-false comparison — arguably worse than the broken default). The `CreateDbClientOptions.plugins` docstring carries the warning + the recommended workaround (use the explicit `'is'` / `'is not'` operators directly via the Kysely expression builder).

`packages/db-pg/__tests__/integration/kysely-safe-null-broken-pg.test.ts` locks the upstream-broken behaviour so an upstream Kysely fix (or our re-introduction of a fixed kickjs-side wrapper) surfaces here.

### Tests

- 6 new unit cases in `packages/db/__tests__/unit/alter-type-helpers.test.ts` — covers the three IR builders + the `before` / `after` mutual-exclusion guard + identifier quoting.
- 4 new integration cases in `packages/db-pg/__tests__/integration/kysely-safe-null-broken-pg.test.ts` — Testcontainers PG 16, raw protocol + end-to-end via `createDbClient({ plugins })`, plus the recommended `'is'` / `'is not'` workaround verification.
- The existing pg-enum-pipeline + default-preservation snapshot tests continue to gate byte-identity of the ALTER TYPE refactor.

`@forinda/kickjs-db`: **392 tests** (was 386 at M5.A.3 cut). `@forinda/kickjs-db-pg`: **32 tests** (was 28). Additive — no breaking change. M5 "no major bumps" rule respected.
