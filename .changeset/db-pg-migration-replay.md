---
'@forinda/kickjs-db-pg': patch
---

test(db-pg): migration replay against real PG — apply / reverse / re-apply cycle

Adds the migration-replay item from [architecture spec §13](https://github.com/forinda/kick-js/blob/main/docs/db/architecture.md) hardening list (deferred when M5 prioritised the AbortSignal / DEFAULT / ReadonlyKysely / ALTER TYPE work; companion to the in-memory diff-engine fuzz that shipped in `@forinda/kickjs-db@5.8.0`).

For every fixture `(from, to)` snapshot pair, runs the full pipeline three times against a real `postgres:16-alpine` Testcontainer:

1. **Forward:** apply `diff(from, to)` → introspect → assert ≡ `to`. Catches missing changes, bad SQL emit, introspection round-trip drift.
2. **Reverse:** apply `invertChanges(diff(from, to))` → introspect → assert ≡ `from`. Catches inverter omitting a change or producing un-applyable SQL.
3. **Replay:** re-apply the original forward → introspect → assert ≡ `to`. Catches non-idempotent reverse — i.e., a reverse that leaves residue causing the second apply to land in a different shape.

5 fixtures × 3 phases = **15 new integration cases**, covering the patterns that account for the bulk of real migration work:

- empty → 1 table with PK + non-null column.
- Add nullable column.
- Add 2nd table with FK pointing at the first.
- Add unique index.
- Alter column nullability + default (the trickiest path — exercises the type-changed / nullable-changed / default-changed branch combo).

### Finding from the first run (worth documenting)

The replay surfaced a real **contract clarification** in how `default` values flow through the snapshot:

- Snapshot `default` field stores the **string value**, NOT the SQL representation. `emit/pg.ts:formatDefault` wraps it (`'foo'`); `introspect-pg.ts:normalizeDefault` strips it. A fixture storing `"'foo'"` (with literal quotes inside the value) would cycle into `''foo''` on re-apply — quotes doubled by `quoteLiteral` then unstripped by `normalizeDefault`.

The fixture comment in `migration-replay-fixtures.ts` documents this so future readers don't trip on it. Not changing the contract — `'value'` (unquoted) is the natural shape per the existing `introspect-pg.test.ts` assertions, just wasn't surfaced anywhere obvious.

### Numbers

`@forinda/kickjs-db-pg`: **50 tests** (was 35 at the safe-null-comparison-workaround cut). Patch — test-only, no src change in the peer adapter. Stays on 5.x. PG cycle cost: ~80s for the full file (one container boot + 15 forward/reverse/replay cycles).

### Architecture-spec §13 hardening remaining after this

- **Benchmarks** vs drizzle / prisma / raw `pg` — perf-bound for adopters with hot paths.
- **SQL emission threat model** — confirm binding-only hot paths, no string interpolation that could become injection.

The diff-engine fuzz + this replay test cover the two highest-confidence-buy items. The bench + threat model are smaller-scope follow-ups.
