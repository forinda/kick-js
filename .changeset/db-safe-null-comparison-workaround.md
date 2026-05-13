---
'@forinda/kickjs-db': minor
'@forinda/kickjs-db-pg': patch
---

feat(db): `safeNullComparison()` plugin — kickjs-side workaround for Kysely's broken upstream

`@forinda/kickjs-db` now exports its own `safeNullComparison()` plugin. Wire it through `createDbClient({ plugins: [...] })` so `eb('col', '=', null)` (plus `!=` / `<>`) compiles to `IS NULL` / `IS NOT NULL` instead of the silently-false `= NULL` default.

```ts
import { createDbClient, safeNullComparison } from '@forinda/kickjs-db'

const db = createDbClient({
  schema,
  dialect: pgDialect({ pool }),
  plugins: [safeNullComparison()],
})

await db.selectFrom('users').where('deletedAt', '=', null).selectAll().execute()
// → SQL: select * from "users" where "deletedAt" is null   (no parameter)
```

The kickjs version emits the literal `null` keyword inline using `ValueNode.createImmediate(null)`, producing valid PostgreSQL. Pass this — NOT Kysely's `SafeNullComparisonPlugin` — through `plugins`. The Kysely upstream version is broken on PG (rewrites the operator but keeps the null operand parameterised, producing `WHERE "col" IS $1` which PG rejects with `syntax error at or near "$1"`); tracked upstream at <https://github.com/forinda/kick-js/issues/220>.

When upstream Kysely fixes their transformer, this kickjs wrapper can collapse to a one-line re-export of Kysely's plugin.

Tests: 7 new unit cases in `packages/db/__tests__/unit/safe-null-comparison.test.ts` (broken-default lock, `=` / `!=` / `<>` rewrite + non-null-passthrough + `is` passthrough). 3 new integration cases in `packages/db-pg/__tests__/integration/kysely-safe-null-broken-pg.test.ts` — Testcontainers PG 16 row-level verification. The existing locks on Kysely's broken upstream behaviour stay so an upstream fix surfaces loudly.

`@forinda/kickjs-db`: 399 tests (was 392). `@forinda/kickjs-db-pg`: 35 tests (was 32). Patch on `@forinda/kickjs-db-pg` (test-only — no src change in the peer adapter).

Additive — no breaking change.
