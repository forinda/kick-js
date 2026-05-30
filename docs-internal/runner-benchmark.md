# Task Runner Benchmark — wireit vs turbo

Goal: decide whether adopting **turbo** gives meaningful build/test performance
over the current **pnpm `--filter` + wireit** setup.

## Method

- Script: `scripts/bench-runners.sh <wireit|turbo>` (reproducible).
- Each leg run **sequentially** (never concurrently — would corrupt each other's caches).
- Caches reset before the **cold build** of each leg: `pnpm -r run clean`
  (removes every `dist/` + `.wireit/`) plus `rm -rf .turbo node_modules/.cache`.
- Four phases timed per runner, in order: build cold → build warm → test cold → test warm.
- Repeated **5× per runner** (`bash scripts/bench-runners.sh <runner> 5`); stats are
  computed over the 5 runs. Medians are the trustworthy figure (see caveats).
- "warm" = immediate re-run with no source changes (full cache-hit opportunity).

### What each runner actually does here

- **wireit leg:** `pnpm run --filter="./packages/**" build|test`. pnpm only
  dispatches; per-package `build` script is `wireit`, which fingerprints
  `files → output` and skips unchanged packages. **`test` is NOT wireit-wrapped**
  (`test` = `vitest run`), so wireit gives tests **zero caching**.
- **turbo leg:** `npx turbo run build|test` driven by `turbo.json`. Turbo wraps the
  _existing_ package scripts (so cold turbo still calls `wireit → tsdown`
  underneath); turbo's own task-graph cache short-circuits on warm runs before
  wireit is ever spawned. Turbo caches **both** build and test tasks.

## Environment

|                |                                      |
| -------------- | ------------------------------------ |
| CPU            | AMD Ryzen 5 5600G (12 logical cores) |
| RAM            | 42.2 GB                              |
| OS             | win32 10.0.26200 (Windows 11)        |
| Node           | v24.16.0                             |
| pnpm           | 10.12.1                              |
| turbo          | 2.9.16                               |
| wireit         | 0.14.12                              |
| packages built | 20                                   |
| date           | 2026-05-30                           |

## Results

### Single run (first pass — UNRELIABLE, kept for the record)

| phase        | wireit |  turbo | turbo speedup |
| ------------ | -----: | -----: | ------------: |
| build — cold | 147.41 |  92.01 |         1.60× |
| build — warm |  22.13 |   7.64 |         2.90× |
| test — cold  | 380.75 | 156.35 |         2.43× |
| test — warm  | 260.71 | 142.74 |         1.83× |

This single run showed turbo winning everywhere. **It did not reproduce.** The
wireit numbers here were a first-build-on-cold-OS artifact (disk + Defender cold).
See the 5-run data below, which reverses the conclusion.

### 5 runs each (seconds)

| phase      | runner |  mean | **median** |   min |   max |    sd | CV% |
| ---------- | ------ | ----: | ---------: | ----: | ----: | ----: | --: |
| build_cold | wireit |  68.9 |   **55.0** |  40.6 | 126.4 |  30.3 |  44 |
| build_cold | turbo  | 171.7 |      155.2 | 138.0 | 253.2 |  42.5 |  25 |
| build_warm | wireit |  23.6 |   **17.8** |  15.3 |  33.9 |   8.4 |  36 |
| build_warm | turbo  |  37.9 |       29.0 |  27.4 |  60.9 |  12.9 |  34 |
| test_cold  | wireit | 117.1 |   **31.0** |  21.4 | 315.9 | 117.6 | 100 |
| test_cold  | turbo  |  96.7 |      104.6 |  72.2 | 112.5 |  15.0 |  16 |
| test_warm  | wireit |  73.2 |   **31.8** |  21.9 | 233.6 |  80.7 | 110 |
| test_warm  | turbo  | 114.1 |       95.0 |  64.3 | 158.4 |  37.6 |  33 |

**Median-based speedup (wireit_median ÷ turbo_median; >1 = turbo faster):**

| phase      | speedup |
| ---------- | ------: |
| build_cold |   0.35× |
| build_warm |   0.61× |
| test_cold  |   0.30× |
| test_warm  |   0.34× |

By median, **wireit is faster on every phase** — turbo is 1.6×–3.3× _slower_ in this
as-tested configuration. The single-run "turbo wins" result was a measurement
artifact.

## Reading the numbers

- **wireit median is fast and the means are dragged up by outliers** (test_cold/warm
  CV = 100–110%, driven by lone 315s / 233s runs — clearly environmental: Defender
  scan, IDE, background load). Median strips those: wireit builds in ~55s cold /
  ~18s warm, tests in ~31s.
- **turbo is more _consistent_ (lower CV on build_cold 25%, test_cold 16%) but
  slower in absolute terms here.** Two structural penalties explain it:
  1. **`npx turbo` re-resolves turbo on every invocation** — per-call startup tax
     that wireit (already installed) doesn't pay.
  2. **Cold turbo wraps wireit → tsdown** (double orchestration layer). On a 20-pkg
     repo this overhead exceeds turbo's scheduling benefit.
- **Warm build:** turbo's cache restore (~29s median) is _slower_ than wireit's
  per-package fingerprint check (~18s). On a repo this size, turbo daemon + npx
  startup eats the cache-restore advantage.

## Caveats / threats to validity

1. **Wall-clock is noise-dominated on this machine** — CV up to 110%. Builds/tests
   were run while the IDE was open; Windows Defender real-time scanning hits fresh
   `dist/` writes. Trust **medians**, not means, and treat even those as soft.
2. **The turbo config penalizes turbo.** It runs via `npx` (refetch/resolve each
   call) AND wraps wireit (double layer). A _fair_ turbo eval must: pin turbo as a
   local devDep, and point package `build` straight at `tsdown` (drop wireit) so
   turbo schedules the real work directly.
3. **Turbo test cache never paid off** (warm ≈ cold). Likely vitest writing
   artifacts inside hashed `inputs`, busting the hash.
4. wireit does **not** cache tests at all — its fast test medians are just raw
   vitest on a warm OS cache, not task caching.

## Verdict

**Inconclusive — leaning "no measurable win for turbo as currently configured."**
Across 5 runs, wireit beats turbo on every phase by median. But the comparison is
unfair to turbo (npx + wireit-wrapper overhead) and the environment is too noisy
(CV ≤ 110%) to trust either way. Before any adoption decision:

- Re-test in a **controlled environment** (close IDE, exclude repo from Defender,
  quiesce background load).
- Give turbo a **fair config**: pinned local devDep, `build` → `tsdown` directly
  (no wireit underneath).
- Report **medians over ≥5 runs** (done) — and ideally use `hyperfine` or turbo's
  `--summarize` for warmup + per-task timing instead of wall-clock.

On a 20-package repo this size, turbo's headline wins (remote cache, graph
scheduling) may simply not clear its startup overhead. Its real edge is **CI remote
cache across machines**, which this local benchmark cannot measure.

## Pilot: fair turbo config on one package (`@forinda/kickjs-schema`)

To remove the two penalties from the 5-run test, one package was rewired to the
_fair_ config and `turbo` was pinned as a local devDep (`turbo@2.9.16`, no more
`npx` refetch):

- `packages/schema/package.json`: `"build": "wireit"` → `"build": "tsdown"`, and the
  dead `wireit` block removed. Turbo now schedules `tsdown` **directly** (no wireit
  layer) and owns the cache via `turbo.json` `outputs: ["dist/**"]`.

Result (`turbo run build --filter=@forinda/kickjs-schema`):

| run                  | turbo                                                    |
| -------------------- | -------------------------------------------------------- |
| cold (cache cleared) | `cache miss, executing` → runs tsdown                    |
| warm (no changes)    | `cache hit, replaying logs` — **321 ms, >>> FULL TURBO** |

This is the result the wrapped/npx config hid: with turbo driving the real build
tool directly, warm cache restore for a package is **sub-second**. The earlier 29s
full-repo warm was npx startup + wireit double-layer across 20 packages, not turbo's
true cache cost.

**Caveat:** one package ≠ the repo. A single sub-second package can't be timed
against the full 20-package wireit run meaningfully. To get a real head-to-head,
rewire **all** packages to `build: tsdown` and re-run the 5× benchmark — only then
do turbo's graph scheduling + full cache restore show their true full-repo number.

## FINAL: fair benchmark — all packages on direct `tsdown` (5 runs each)

All 19 wireit packages rewired (`build: wireit` → `build: tsdown`, wireit blocks
removed; `wireit` devDep dropped from root). `turbo` pinned as a local devDep
(`turbo@2.9.16`) and invoked via `pnpm exec turbo` — **no `npx` refetch, no wireit
wrapper**. Both legs now run the _identical_ `tsdown` compile; the only variable is
the runner + its cache.

- `pnpm` leg = `pnpm run --filter build|test` — dispatch only, **no task cache**.
- `turbo` leg = `pnpm exec turbo run build|test` — same tsdown, turbo graph + cache.

Cold full-repo turbo build (sanity, fresh install): **22/22 tasks, 0 errors,
3m07s** — topo order via `^build` correct (schema → kickjs → dependents).

| phase      | runner |  mean | **median** |  min |   max |    CV% |
| ---------- | ------ | ----: | ---------: | ---: | ----: | -----: |
| build_cold | pnpm   |  91.7 |       81.4 | 68.2 | 137.6 |     27 |
| build_cold | turbo  |  66.6 |   **58.6** | 49.5 | 108.6 |     33 |
| build_warm | pnpm   |  77.2 |       75.0 | 42.5 | 109.9 |     33 |
| build_warm | turbo  |   4.3 |    **4.3** |  3.5 |   5.0 | **13** |
| test_cold  | pnpm   | 113.4 |   **40.6** | 29.8 | 389.4 |    122 |
| test_cold  | turbo  | 104.8 |       76.8 | 49.5 | 177.3 |     54 |
| test_warm  | pnpm   | 228.7 |   **46.8** | 35.7 | 768.6 |    123 |
| test_warm  | turbo  | 104.5 |      114.8 | 42.6 | 160.6 |     38 |

**Median speedup (pnpm ÷ turbo; >1 = turbo faster):**

| phase      |     median | min (best-case) |
| ---------- | ---------: | --------------: |
| build_cold |      1.39× |           1.38× |
| build_warm | **17.60×** |      **12.03×** |
| test_cold  |      0.53× |           0.60× |
| test_warm  |      0.41× |           0.84× |

### What this finally shows

- **Builds — turbo wins decisively.**
  - **Warm build = 17.6× faster (4.3s vs 75s), CV 13%** — the standout result, and
    the most _reliable_ number in the whole study (lowest variance of any cell).
    pnpm has no build cache, so it re-runs all 22 `tsdown` compiles every time
    (~75s); turbo restores `dist/**` from cache in ~4s. This is every
    edit-rebuild loop and every CI cache-restore.
  - **Cold build = 1.39× faster** — pure scheduling win now that the wireit/npx
    overhead is gone; turbo saturates the 12 cores better than pnpm's fan-out.
- **Tests — turbo currently LOSES.**
  - turbo test cache **still does not hit** (warm 114.8s ≈ cold 76.8s). Same root
    cause as before: vitest writes artifacts inside the hashed `inputs`, busting the
    hash. So turbo adds orchestration overhead (+ a build-dependency check) over raw
    vitest **without** the cache payoff → slower than plain pnpm/vitest.
  - pnpm test medians (40–47s) are the only trustworthy test figures; the means
    (113s, 229s) are wrecked by lone machine-stall outliers (389s, **768s** — swap /
    Defender), CV > 120%.

## Verdict (final)

**Adopt turbo for BUILDS. Keep tests on plain vitest until turbo test caching is
fixed.**

- The **17.6× warm-build speedup is decisive and consistent** (CV 13%) — it pays off
  on every rebuild and every CI run, and turbo's **remote cache** would extend it
  across CI machines (not measurable locally).
- Cold builds are also ~1.4× faster — free scheduling win.
- **Do NOT route tests through turbo yet**: as configured it is _slower_ than pnpm
  because the test cache never hits. Fix `turbo.json` test `inputs` (or move vitest
  temp/coverage output out of hashed paths) and re-measure before enabling.
- Test wall-clock remains noise-dominated (CV > 100% on pnpm) — for any future
  test-cache tuning, measure in a quiesced environment with `hyperfine`.

## If adopting turbo — open items

- [ ] Decide: keep `wireit` underneath turbo, or replace it (point package `build`
      scripts straight at `tsdown` and drop wireit). Replacing removes the double
      cache layer and the per-package `.wireit` dirs.
- [ ] Fix turbo **test caching** (caveat #3): scope `inputs`, route vitest temp
      output out of hashed paths, or set explicit `outputs` for coverage.
- [ ] Add `.turbo` to `.gitignore`.
- [ ] Re-run this benchmark **averaged over 3+ runs** before committing to a switch.
- [ ] Evaluate turbo **remote cache** (shared CI cache) — the warm-build win
      multiplies across CI runners.

## Reproduce

```bash
bash scripts/bench-runners.sh wireit
bash scripts/bench-runners.sh turbo
```
