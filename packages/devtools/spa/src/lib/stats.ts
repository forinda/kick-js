/** Small numeric helpers for the Overview — pure, so they're unit-tested. */

/** Differences between consecutive cumulative counts — per-interval rates. */
export function deltas(counts: readonly number[]): number[] {
  const out: number[] = []
  // A drop means the app restarted and its counters reset — count from zero.
  for (let i = 1; i < counts.length; i++) out.push(Math.max(0, counts[i]! - counts[i - 1]!))
  return out
}

/** The `p`th percentile (0–100) by nearest rank; `undefined` for no values. */
export function percentile(values: readonly number[], p: number): number | undefined {
  if (values.length === 0) return undefined
  const sorted = values.toSorted((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))]
}
