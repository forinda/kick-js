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

/** HTTP method → text colour, shared by the Routes tab and the API runner. */
export function methodColor(method: string): string {
  const m = method.toUpperCase()
  if (m === 'GET') return 'text-emerald-400'
  if (m === 'POST') return 'text-cyan-400'
  if (m === 'PUT' || m === 'PATCH') return 'text-amber-400'
  if (m === 'DELETE') return 'text-red-400'
  return 'text-text-secondary'
}

/** HTTP status → pill class (`.dt-pill` + tone), shared by the runner and the Requests tab. */
export function statusPill(status: number): string {
  const tone = status >= 500 ? 'err' : status >= 400 ? 'warn' : status >= 300 ? 'redir' : 'ok'
  return `dt-pill dt-pill-${tone}`
}

/**
 * Tinted label colour for a DI kind (`.dt-tone` + hue). Mid-tone hues on a
 * 15% tint of themselves, so the label reads in both themes.
 */
export function kindTone(kind: string | undefined): string {
  const hue =
    kind === 'controller'
      ? 'violet'
      : kind === 'service'
        ? 'blue'
        : kind === 'repository'
          ? 'teal'
          : 'gray'
  return `dt-tone dt-tone-${hue}`
}

/** Tinted label colour for a severity. */
export function severityTone(level: 'ok' | 'warn' | 'err' | 'idle'): string {
  return `dt-tone dt-tone-${{ ok: 'green', warn: 'amber', err: 'red', idle: 'gray' }[level]}`
}

/**
 * Text colour for a duration: amber above 200ms, orange above 500ms, red
 * above 1s — scaled by `factor` for contexts with tighter budgets.
 */
export function durationTone(ms: number, factor = 1): string {
  const v = ms * factor
  if (v > 1000) return 'text-red-500'
  if (v > 500) return 'text-orange-500'
  if (v > 200) return 'text-amber-500'
  return ''
}

/** `12s ago`, `4m ago`, `3h ago` — for timestamps in ms since epoch. */
export function ago(at: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - at) / 1000))
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86_400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86_400)}d ago`
}

/** A stable colour per name — the same event namespace is always the same hue. */
export function hashColor(name: string): string {
  let hash = 0
  for (const c of name) hash = c.charCodeAt(0) + ((hash << 5) - hash)
  // 12 hues 30° apart: a few namespaces stay tellable apart, unlike raw hash % 360.
  return `hsl(${(Math.abs(hash) % 12) * 30} 60% 50%)`
}
