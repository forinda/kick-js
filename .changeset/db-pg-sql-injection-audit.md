---
'@forinda/kickjs-db-pg': patch
---

test(db-pg): SQL emission threat model — adversarial-input audit against real PG

Final hardening item from [architecture spec §13](https://github.com/forinda/kick-js/blob/main/docs/db/architecture.md): "Threat-model SQL emission (binding-only, no string interpolation in hot paths)." Pairs with the new spec at [`docs/db/spec-sql-emission-threat-model.md`](https://github.com/forinda/kick-js/blob/main/docs/db/spec-sql-emission-threat-model.md) which documents the trust boundary.

### Audit summary

- **Runtime values** flow through Kysely's `ExpressionBuilder` → parameter binding (`$N`/`?`/`@N`). Safe.
- **DDL identifiers** flow through `quoteIdent` (double-quoted, internal `"` doubled per SQL standard). Safe.
- **DDL literals** flow through `quoteLiteral` (single-quoted, internal `'` doubled). Safe.
- **Type strings + adopter `customType({ dataType })`** are interpolated raw — code-time-controlled (adopters writing their own SQL injection there are injecting into their own code; not in scope).

### Adversarial coverage

`packages/db-pg/__tests__/integration/sql-injection-pg.test.ts` runs 24 new cases against a real `postgres:16-alpine` Testcontainer:

- **19 value-binding tests**: insert + select round-trip with every common injection class — single-quote escape, double-quote, dollar-quoting, statement terminator + DROP, `pg_sleep` timing attack, C-style comments (including nested), E-string escapes, EXECUTE/FORMAT combos, stacked statements, boolean-blind algebra, subquery injection, UNION injection, WAITFOR DELAY (cross-dialect), pg_catalog snooping, URL-encoded payloads. Each test seeds a canary row and asserts (a) the adversarial value round-trips byte-identical, (b) the table still has exactly 2 rows (canary + the value), proving no out-of-band SQL ran.
- **2 operator coverage tests**: `in (...)` array binding + `like` pattern matching, both with adversarial payloads.
- **3 identifier-escape tests**: tables and columns whose names contain `"`, `;`, embedded `DROP TABLE` statements. `quoteIdent` produces SQL PG accepts as a single (weird-but-valid) identifier; introspection round-trips the literal name.

### Finding from the first run

The deliberately-bad-identifier test surfaced a **legitimate test-harness limitation**, not a `@forinda/kickjs-db` bug: splitting emitted SQL on `;` client-side breaks when an identifier contains a literal `;`. PG's simple-query protocol respects quoted-identifier boundaries; passing `emitPg` output as one multi-statement query works correctly. Updated the test to use that path. The `migration-replay-pg.test.ts` `applyChanges` helper has the same client-side `;`-split — it's safe in that context because the fixtures don't have weird identifiers, but worth flagging if future replay fixtures get nastier.

### Numbers

`@forinda/kickjs-db-pg`: **74 tests** (was 50 at the migration-replay cut). Patch — test-only + new spec doc, no src change. Stays on 5.x.

### Architecture-spec §13 hardening status

| Item                                                       | Status                           |
| ---------------------------------------------------------- | -------------------------------- |
| Diff-engine fuzz (1000 random pairs, in-memory round-trip) | ✅ `@forinda/kickjs-db@5.8.0`    |
| Migration replay (real PG, 5 fixtures × 3 phases)          | ✅ `@forinda/kickjs-db-pg@9.0.4` |
| SQL emission threat model                                  | ✅ this PR                       |
| Benchmarks vs drizzle / prisma / raw `pg`                  | ⏳ remaining                     |

Only benchmarks remain. The correctness + security bars from the architecture spec are now met.
