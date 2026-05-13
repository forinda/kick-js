import { describe, expect, it } from 'vitest'
import { diff, hasAmbiguousReverse, invertChanges } from '@forinda/kickjs-db'
import { applyChangeSet, snapshotsEqual } from './apply-changeset'
import { generateSnapshot } from './random-schema'

// Architecture spec §13 hardening — 1000 random schema-pair fixtures
// asserting two structural properties on the diff engine:
//
//   1. **Forward fidelity:** `applyChangeSet(A, diff(A, B)) ≡ B` for
//      every pair. If this fails, the forward diff is incomplete —
//      either it skipped a change that should have been emitted, or
//      it emitted one that doesn't transform A toward B.
//
//   2. **Reverse fidelity:** `applyChangeSet(B, invertChanges(diff(A, B))) ≡ A`
//      *when the forward change set is not flagged
//      `hasAmbiguousReverse`*. Ambiguous-reverse change kinds
//      (dropTable, dropColumn, alterColumn, addEnumValue,
//      removeEnumValue) are documented as best-effort drafts that
//      require operator review; their round-trip is intentionally
//      lossy on the type side (e.g. dropping a column then re-adding
//      it loses the original type / default unless the snapshot
//      carried both, which the diff engine does — but operator
//      intent isn't preserved). Skipping these keeps the assertion
//      meaningful: only changes that *claim* to be exactly reversible
//      have to round-trip.
//
// Seeds: 0..999. Failing seed prints in the assertion so a repro is
// `generateSnapshot(seed * 2)` + `generateSnapshot(seed * 2 + 1)`.

const SEED_COUNT = 1000

describe('diff engine fuzz — 1000 seeds, round-trip property', () => {
  let ambiguousSkipped = 0

  it('forward: applyChangeSet(A, diff(A, B)) ≡ B for all 1000 pairs', () => {
    const failures: string[] = []
    for (let seed = 0; seed < SEED_COUNT; seed++) {
      const A = generateSnapshot(seed * 2)
      const B = generateSnapshot(seed * 2 + 1)
      const forward = diff(A, B)
      const applied = applyChangeSet(A, forward)
      if (!snapshotsEqual(applied, B)) {
        failures.push(
          `seed=${seed} (A=generateSnapshot(${seed * 2}), B=generateSnapshot(${seed * 2 + 1}))`,
        )
        if (failures.length >= 5) break // bail early — pattern, not catalogue
      }
    }
    expect(failures, `forward fidelity failed for:\n  ${failures.join('\n  ')}`).toEqual([])
  })

  it('reverse: applyChangeSet(B, invert(diff(A, B))) ≡ A when no ambiguous-reverse changes', () => {
    const failures: string[] = []
    for (let seed = 0; seed < SEED_COUNT; seed++) {
      const A = generateSnapshot(seed * 2)
      const B = generateSnapshot(seed * 2 + 1)
      const forward = diff(A, B)
      if (hasAmbiguousReverse(forward)) {
        ambiguousSkipped++
        continue
      }
      const reverse = invertChanges(forward)
      const applied = applyChangeSet(B, reverse)
      if (!snapshotsEqual(applied, A)) {
        failures.push(
          `seed=${seed} (A=generateSnapshot(${seed * 2}), B=generateSnapshot(${seed * 2 + 1}))`,
        )
        if (failures.length >= 5) break
      }
    }
    expect(failures, `reverse fidelity failed for:\n  ${failures.join('\n  ')}`).toEqual([])
    // Sanity check on fixture diversity: with 1000 random pairs and a
    // generator that often creates / drops tables (an ambiguous kind),
    // most pairs should be flagged ambiguous. If almost zero are, the
    // generator is producing degenerate / empty schemas and the
    // assertion above is vacuous.
    expect(ambiguousSkipped).toBeGreaterThan(SEED_COUNT * 0.1)
  })

  it('reflexivity: diff(A, A) === [] for all generated snapshots', () => {
    const failures: number[] = []
    for (let seed = 0; seed < SEED_COUNT; seed++) {
      const A = generateSnapshot(seed)
      if (diff(A, A).length !== 0) failures.push(seed)
      if (failures.length >= 5) break
    }
    expect(failures, `non-empty self-diff for seeds: ${failures.join(', ')}`).toEqual([])
  })
})
