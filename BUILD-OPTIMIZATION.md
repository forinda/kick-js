# Build Optimization Experiment

Branch: `build-optimization`
Status: **EXPERIMENTAL** — not for merge, just to measure what wins
Scope: `@forinda/kickjs` (core) only, then extend if it works

## Why

CI typecheck + test currently takes ~10 minutes. Local builds feel slow too. The hot path is dominated by TypeScript's `tsc` running for declaration emission and for per-package `--noEmit` checks. Everything else on the toolchain is already Rust (rolldown, oxlint, oxfmt, oxc) so there's no quick win to extract from JS-bound transformers.

This branch tests four Tier-1 optimizations on `@forinda/kickjs` to see which actually help, in what magnitude, and at what migration cost.

## Hypotheses to test

| #   | Change                                                                       | Expected effect                                                                 | Risk                                                             |
| --- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| H1  | Vitest workspace mode                                                        | Single Vitest process across packages → cuts test startup overhead              | low                                                              |
| H2  | `tsdown` declaration emitter via oxc (`isolatedDeclarations`) instead of tsc | 10–50× faster dts emission                                                      | medium — every exported symbol needs an explicit type annotation |
| H3  | TypeScript project references + `composite: true`                            | Incremental tsc reuses cache; eliminates the build-before-typecheck dance in CI | medium — config rewrite per package                              |
| H4  | Skip `pnpm build` in CI typecheck job (after H3 lands)                       | -2 min on each CI typecheck                                                     | depends on H3                                                    |

This experiment touches **only kickjs** to keep blast radius small. If H1–H4 show real wins, we propagate across packages.

## Measurement methodology

For each scenario:

1. Clean the wireit cache: `rm -rf packages/kickjs/.wireit packages/kickjs/dist`
2. Run the target command 3 times. Discard the first (warm-up), take median of the next 2.
3. Record on Windows since that's the primary dev environment. (Linux CI will show different absolute numbers but the same relative wins.)

Three target commands:

- `pnpm --filter @forinda/kickjs build` — full build including dts
- `pnpm --filter @forinda/kickjs typecheck` — tsc --noEmit
- `pnpm --filter @forinda/kickjs test` — full Vitest run

Plus, when relevant: `pnpm -r run test` and `pnpm -r run typecheck` to see workspace-level effects.

## Baseline (Windows, local)

Measured with `time` on a clean wireit cache. Workspace targets ran with `pnpm -r` over published packages only (`--filter '@forinda/*' --filter '!*example*'`).

### kickjs alone (the target package for the experiment)

| Command                     | Run 1         | Run 2 | Run 3 | Median    |
| --------------------------- | ------------- | ----- | ----- | --------- |
| `kickjs build` (cold cache) | 5.6s          | 5.4s  | 5.3s  | **~5.3s** |
| `kickjs typecheck`          | 3.7s          | 3.1s  | 3.1s  | **~3.1s** |
| `kickjs test`               | 11.3s (flake) | 9.0s  | —     | **~9.0s** |

### Full workspace (packages only)

| Command                   | Time       |
| ------------------------- | ---------- |
| `pnpm build` (full)       | **22.8s**  |
| `pnpm -r typecheck`       | **15.2s**  |
| `pnpm -r --parallel test` | **4m 57s** |

### The surprise — CLI tests dominate

Inside the 4m57s test run, `packages/cli test` alone is **293s** (4m53s) of the wall time. The other 19 packages finish before the CLI suite is half-done. The CLI tests invoke `tsc --noEmit` against generated fixtures (`config-service.test.ts`, `typegen-token-conventions.test.ts`, `env-typing.test.ts`, etc.) — those internal `tsc` shellouts are the actual bottleneck, not Vitest startup or rolldown's dts pass.

**Implication for the experiment:** the original H1–H4 hypotheses overweight `tsdown` dts and Vitest startup. The actual hot path is _adopter-fixture tsc inside CLI tests_. Tier 1 needs a re-rank.

### Pre-experiment plan revision

- H1 (Vitest workspace) — still try; cleans up the run, marginal time win.
- H2 (isolatedDeclarations + oxc dts) — kickjs build is only 5s, so the upper-bound win is ~3s on kickjs. Smaller benefit than expected.
- H3 (project references) — saves the ~23s build that CI does before typecheck. Real but modest at the whole-workspace level.
- **NEW: H5 — speed up CLI typegen tests.** The 293s is split across ~10 test files that shell out to tsc. Options:
  1. Reuse one tsc process across fixtures instead of spawning per-test (process startup cost).
  2. Replace `tsc --noEmit` fixture validation with type-only assertions (vitest-style `expectTypeOf`).
  3. Switch fixtures to `isolatedDeclarations` so an oxc-based emitter can validate them.
- **NEW: H6 — remove `examples/*` from the workspace** (decision pending). Their install + typecheck + test footprint is non-trivial; they're scaffolded reference apps, not framework code.

## H1 — Vitest workspace mode

**Hypothesis:** Running all packages' tests through one Vitest process (workspace mode) eliminates per-package boot overhead. Each `pnpm --filter X test` currently spins up its own transformer pipeline; workspace mode shares one.

**How:** Add a root `vitest.workspace.ts` that lists each package's vitest config. Change root `pnpm test` to invoke Vitest workspace.

**Test:** Time `pnpm -r run test` vs the workspace-mode equivalent on the whole monorepo.

**Status:** Pending.

## H2 — Native dts emitter via `isolatedDeclarations`

**Hypothesis:** `tsdown` invokes `tsc` via `rolldown-plugin-dts` to emit `.d.mts` files. That's the longest stage of the build per the plugin's own `[PLUGIN_TIMINGS]` warning. Switching to oxc's dts emitter (which doesn't run type inference) should be ~10× faster but requires every exported symbol to have an explicit type annotation.

**How:**

1. Add `"isolatedDeclarations": true` to `packages/kickjs/tsconfig.json`
2. Count the violations (every "inferred return type" error)
3. Decide:
   - **(a)** Fix all violations, switch tsdown's `dts` option to use oxc emitter → measure full-pipeline gain
   - **(b)** Count-only: confirm scope before committing to the migration

**Test:** Time `pnpm --filter @forinda/kickjs build` before vs after.

**Status:** Pending.

## H3 — TypeScript project references

**Hypothesis:** Each package's `tsc --noEmit` reads its dependencies' built `.d.mts` files via `package.json` exports. That's why CI runs `pnpm build` before `pnpm -r typecheck`. With composite project references, `tsc --build` walks the project graph directly and reuses incremental cache.

**How:**

1. Add `"composite": true` + `"declarationMap": true` to each package's `tsconfig.json`
2. Declare `"references": [{ "path": "../X" }]` for cross-package deps
3. Run `tsc -b` from the root instead of per-package `tsc --noEmit`
4. (Optional) Remove the `pnpm build` step from the CI typecheck job

**Test:**

- Full-clean: `tsc -b --force` vs current state
- Incremental: touch one file, then `tsc -b`, vs the current pipeline

**Status:** Pending.

## H4 — Skip the build-before-typecheck step in CI

Depends on H3 landing. Mechanical change to `.github/workflows/ci.yml`. No measurement work — the saving equals the build duration.

## Out of scope (deferred)

- **Binary distribution** (Bun compile, Node SEA) — separate concern, larger scope, won't move CI time. Tracked separately.
- **Remote build cache** — wireit supports it; verifying is a separate ticket.
- **tsgo / TypeScript Go rewrite** — too early.
- **Build-time gains in other packages** — extend after kickjs validates the pattern.

## Decision tree

- If H1 saves ≥30% on test wall time → adopt workspace mode unconditionally; cheap and reversible.
- If H2 saves ≥40% on build wall time AND violation count is <100 → migrate kickjs to `isolatedDeclarations`, then propagate.
- If H2 saves ≥40% but violations are >200 → defer until we have a codemod that adds the annotations automatically.
- If H3 saves ≥1 min on CI typecheck → migrate to project references across the workspace.
- H4 follows mechanically from H3.

The success bar is concrete time saved on a clean CI run — not micro-benchmarks.

## Log

### Run 1 — baseline (before example extraction)

Local on Windows, single-thread Vitest, examples/\* still in the workspace:

| Step                             | Time                                                                           |
| -------------------------------- | ------------------------------------------------------------------------------ |
| `pnpm install --frozen-lockfile` | ~90s (includes prisma generate, sharp, argon2 postinstalls for 9 example apps) |
| `pnpm build` (packages only)     | 22.8s                                                                          |
| `pnpm -r typecheck`              | 15.2s                                                                          |
| `pnpm -r --parallel test`        | **4m 57s** (293s of that was `packages/cli` alone)                             |

### Run 2 — example extraction (PR #279 merged)

| Step                             | Time    | Δ                                                                              |
| -------------------------------- | ------- | ------------------------------------------------------------------------------ |
| `pnpm install --frozen-lockfile` | **12s** | -78s                                                                           |
| `pnpm build` (packages only)     | 22-40s  | variance (cold cache)                                                          |
| `pnpm -r typecheck`              | 20s     | +5s (variance)                                                                 |
| `pnpm -r --parallel test`        | 2m 18s  | -2m 39s (mostly db-pg local-Postgres timeouts; real test wall is much smaller) |

**Result:** the example extraction alone accounted for ~5-7 minutes of CI wall time when summed across all parallel jobs (each job pays the install cost). That was the biggest single lever in the whole experiment.

### Run 3 — H1: Vitest workspace mode (parallel workers)

Removed `singleThread: true` from root `vitest.config.ts` to let each test file run in its own worker.

| Setup                            | Wall time |
| -------------------------------- | --------- |
| Existing `singleThread: true`    | 3m 40s    |
| Parallel workers (H1)            | 3m 26s    |
| Workspace, excluding db-pg + cli | **55s**   |

**Verdict: not worth shipping.** Only 14 seconds gained. The test wall time is dominated by:

- **db-pg** = ~2 min of Postgres connection timeouts in local env (disappears on CI where Postgres is available)
- **CLI typegen tests** = ~1 min of `tsc` shell-outs against generated fixtures

Neither is something Vitest workspace mode can fix. The rest of the workspace runs 1880 tests across 179 files in 55 seconds — already fast.

Reverted root `vitest.config.ts` to keep `singleThread: true` (parallel workers risk shared-resource flakes for a 14-second gain).

### Run 4 — H7: Single-entry tsdown for kickjs

Inspired by `packages/vite/`'s single-entry pattern. Replaced kickjs's 30+ subpath entries with one `index: 'src/index.ts'` entry.

| Setup                 | Build wall | tsdown phase |
| --------------------- | ---------- | ------------ |
| Current (30+ entries) | 5.6s       | 2.5s         |
| Single entry          | 4.3s       | 1.9s         |

**Verdict: not worth shipping.** Saves ~1.3s on kickjs alone. The kickjs build was 5s of a ~25s workspace build (~5% of total). Dropping subpath exports is a breaking API change for adopters who `import { ... } from '@forinda/kickjs/adapter'` etc. The cost-benefit doesn't justify the migration.

Reverted `packages/kickjs/tsdown.config.ts` to the multi-entry form.

## Conclusions

### What actually worked

**Extracting examples** (PR #279) was the single biggest lever. Removed ~75s from every CI install, eliminated the 9-app prisma/drizzle/mongoose postinstall chain. The framework's CI gate is now ~2-3 minutes wall-clock, not 10.

### What didn't move the needle

- **H1 Vitest workspace mode** — saves 14 seconds; not worth shared-resource flake risk
- **H7 single-entry tsdown for kickjs** — saves 1.3 seconds; breaks subpath exports

H2 (isolatedDeclarations + oxc dts) and H3 (project references) were NOT measured because the kickjs build is already 5 seconds — there's no meaningful headroom for either.

### Where to look next (out of scope for this branch)

The remaining real bottlenecks are package-specific, not framework-wide:

1. **CLI typegen tests** (`config-service.test.ts`, `typegen-token-conventions.test.ts`, `env-typing.test.ts`) — they shell out to `tsc --noEmit` per fixture, single-file, no shared process. Options:
   - Reuse one `tsc --build` process across fixtures
   - Replace fixture-validation-via-tsc with `expectTypeOf` assertions in Vitest
   - Run these as a separate slow-test job in CI

2. **db-pg / db-mysql / db-sqlite tests requiring a DB** — they hang on connection timeout when no DB is available locally. Should fail fast (assert DATABASE_URL is set in `beforeAll`, skip otherwise).

Both are package-specific cleanup, not framework-wide. Neither belongs on this build-optimization branch.

### Branch disposition

This branch is **experimental documentation**, not for merge. The findings stand on their own:

- The 10-minute CI pain was almost entirely the example install footprint
- Extraction (PR #279) covered the win
- The remaining bottlenecks are local-env flakes (db-pg) and per-package test-strategy choices (CLI typegen) — not framework infrastructure

Keep the branch around for the spec doc + future reference. Don't merge.
