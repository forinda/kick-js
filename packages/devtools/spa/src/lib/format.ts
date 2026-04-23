/** Human-readable byte size with 1 decimal of precision past KiB. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MiB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GiB`
}

/** Bytes per second → "MB/min" — the unit users actually reason about. */
export function formatBytesPerSec(bps: number): string {
  if (bps === 0) return '0'
  const perMin = bps * 60
  if (Math.abs(perMin) < 1024 * 1024) return `${(perMin / 1024).toFixed(1)} KiB/min`
  return `${(perMin / 1024 / 1024).toFixed(1)} MiB/min`
}

/** Milliseconds — round to integer for >1ms, 2 decimals below. */
export function formatMs(ms: number): string {
  if (ms < 1) return `${ms.toFixed(2)} ms`
  if (ms < 100) return `${ms.toFixed(1)} ms`
  return `${Math.round(ms)} ms`
}

/** Seconds → "1h 23m 45s" or "12m 34s" or "45s". */
export function formatUptime(seconds: number): string {
  const s = Math.floor(seconds)
  if (s < 60) return `${s}s`
  if (s < 3600) {
    const m = Math.floor(s / 60)
    const r = s % 60
    return `${m}m ${r}s`
  }
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const r = s % 60
  return `${h}h ${m}m ${r}s`
}

/** Whole-percent display — "73%" not "72.94%". */
export function formatPercent(ratio: number): string {
  return `${Math.round(ratio * 100)}%`
}
