/**
 * A route's meta — the flags it carries and the context contributors it
 * runs — summarised for the routes list and listed for the route's panel.
 */
import type { RouteEntry } from './store'

/** `1 flag · ctx 2`: counts only, so the row keeps room for the path. */
export function metaSummary(r: RouteEntry): string {
  const flags = Object.keys(r.flags ?? {}).length
  const ctx = r.contributors?.length ?? 0
  return [flags ? `${flags} flag${flags === 1 ? '' : 's'}` : '', ctx ? `ctx ${ctx}` : '']
    .filter(Boolean)
    .join(' · ')
}

/**
 * Flags in declaration order. A `true` flag is its name alone; any other
 * carries its value — `raw` for structured display, `value` pretty-printed.
 */
export function flagEntries(
  flags?: Record<string, unknown>,
): Array<{ name: string; value?: string; raw?: unknown }> {
  return Object.entries(flags ?? {}).map(([name, v]) =>
    v === true ? { name } : { name, value: JSON.stringify(v, null, 2), raw: v },
  )
}

/** A long list folded to its first `limit` items, unless `all`. */
export function splitList<T>(items: T[], limit: number, all = false): { shown: T[]; more: number } {
  return all || items.length <= limit
    ? { shown: items, more: 0 }
    : { shown: items.slice(0, limit), more: items.length - limit }
}

/** Search over path, controller, handler, flag names and contributor keys. `q` is lower-cased. */
export function routeMatches(r: RouteEntry, q: string): boolean {
  if (!q) return true
  return [
    r.path,
    r.controller,
    r.handler,
    ...Object.keys(r.flags ?? {}),
    ...(r.contributors ?? []).map((c) => c.key),
  ].some((s) => s.toLowerCase().includes(q))
}
