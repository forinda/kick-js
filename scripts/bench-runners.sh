#!/usr/bin/env bash
# Benchmark task-runner performance: pnpm-only (no cache) vs turbo (cache).
# After the all-packages tsdown rewire, the 'pnpm' leg dispatches raw tsdown per
# package with NO task cache; the 'turbo' leg runs the same tsdown via turbo's graph
# + cache. Both compile identically — the only variable is the runner/cache.
# Usage: bash scripts/bench-runners.sh <runner> [runs]
#   runner = pnpm | turbo   (required)
#   runs   = repeat count    (default 1)
# Emits one labeled line per phase per run; caller aggregates.
set -uo pipefail

runner="${1:?pass 'pnpm' or 'turbo'}"
runs="${2:-1}"

now() { date +%s.%N; }
elapsed() { awk "BEGIN{printf \"%.2f\", $2 - $1}"; }

clean_all() {
  pnpm -r run clean >/dev/null 2>&1
  rm -rf .turbo node_modules/.cache 2>/dev/null
}

run_build() {
  case "$runner" in
    pnpm)  pnpm run --filter="./packages/**" build ;;
    turbo) pnpm exec turbo run build ;;
  esac
}

run_test() {
  case "$runner" in
    pnpm)  pnpm run --filter="./packages/**" test ;;
    turbo) pnpm exec turbo run test ;;
  esac
}

echo "=== runner: $runner | runs: $runs ==="

for i in $(seq 1 "$runs"); do
  echo "--- run $i/$runs ---"

  # BUILD cold (caches cleared)
  clean_all
  t0=$(now); run_build >/dev/null 2>&1; t1=$(now)
  echo "run${i}.build_cold=$(elapsed $t0 $t1)"

  # BUILD warm (full cache hit, no changes)
  t0=$(now); run_build >/dev/null 2>&1; t1=$(now)
  echo "run${i}.build_warm=$(elapsed $t0 $t1)"

  # TEST cold
  t0=$(now); run_test >/dev/null 2>&1; t1=$(now)
  echo "run${i}.test_cold=$(elapsed $t0 $t1)"

  # TEST warm
  t0=$(now); run_test >/dev/null 2>&1; t1=$(now)
  echo "run${i}.test_warm=$(elapsed $t0 $t1)"
done

echo "=== done: $runner ==="
