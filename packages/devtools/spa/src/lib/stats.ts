/** Small numeric helpers for the dashboard — pure, so they are unit-tested. */

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

/**
 * Merge samples into a time series by timestamp — one per timestamp, oldest
 * first — and keep the newest `max`. The live stream can resend the sample
 * the history already ended with, or arrive before the history does;
 * charted twice, a sample's CPU time is divided by a ~0ms gap and spikes
 * into the thousands of percent.
 */
export function mergeSamples<T extends { timestamp: number }>(
  prev: readonly T[],
  next: readonly T[],
  max: number,
): T[] {
  const byTime = new Map([...prev, ...next].map((s) => [s.timestamp, s]))
  return [...byTime.values()].toSorted((a, b) => a.timestamp - b.timestamp).slice(-max)
}
