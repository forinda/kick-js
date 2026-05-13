---
'@forinda/kickjs-db': minor
---

test(db): diff-engine fuzz harness — 1000 seeded round-trip property assertions

Adds the diff-engine fuzz suite the original architecture spec ([§13](https://github.com/forinda/kick-js/blob/main/docs/db/architecture.md)) listed as an M5 hardening gate for the "production-grade" claim. 1000 randomly-generated `SchemaSnapshot` pairs run three structural property assertions against the diff engine:

1. **Forward fidelity** — `applyChangeSet(A, diff(A, B)) ≡ B` for every pair. Catches missing changes (forward diff didn't notice some delta) and spurious changes (forward diff moves A away from B).
2. **Reverse fidelity** — `applyChangeSet(B, invertChanges(diff(A, B))) ≡ A` when `hasAmbiguousReverse(forward)` is false. Ambiguous-reverse cases (`dropTable`, `dropColumn`, `alterColumn`, `addEnumValue`, `removeEnumValue`) are documented as best-effort drafts requiring operator review, so the property doesn't hold by design — those seeds are counted-and-skipped.
3. **Reflexivity** — `diff(A, A) === []` for 1000 random snapshots. Catches a class of "always-emits-a-change" false-positives that would burn through migrations forever.

Generator + applier scoped narrowly for the first cut:

- PostgreSQL dialect only — other dialects share the same diff path; their emitters live in separate test scopes.
- No `renameTable` / `renameColumn` (engine doesn't infer renames; those exercise the drop+add path, covered by `diff-rename.test.ts`).
- Simple default values (`'0'`, `"'x'"`, `'true'`, `'CURRENT_TIMESTAMP'`) — avoids the pgEnum-cast-bracket dance that M5.A.1 handles.

### Finding from the first run

The fuzz immediately surfaced an **internal contract** worth documenting: `diff/engine.ts` emits `createTable` changes carrying the full table snapshot (including indexes + FKs), then separately emits `addIndex` / `addForeignKey` for each. The SQL emitter `emit/pg.ts:emitCreateTable` strips indexes/FKs from the CREATE TABLE statement and renders them via the subsequent ALTER TABLE changes. The structural reader (the fuzz applier) has to mirror this stripping behaviour — taking the columns + PK from `createTable` and leaving indexes/foreignKeys empty until the secondary changes populate them. Not a bug — but the contract was implicit; the applier in `__tests__/fuzz/apply-changeset.ts` carries an inline note for the next reader.

### Surface bumps

`@forinda/kickjs-db` minor — `EnumSnapshot` is now exported from the package root (oversight from M3; the rest of the snapshot type family was already public). Used by the fuzz generator but useful generally for adopters reading `SchemaSnapshot.enums`.

### Numbers

`@forinda/kickjs-db`: **402 tests** (was 399 — three new fuzz top-level suites, each iterating 1000 seeds internally). Fuzz iteration cost: ~25 seconds for 3000 seed runs.

Additive — no breaking change. Stays on the 5.x line.
