/**
 * Command palette matching — kept free of Solid and the DOM so it is
 * unit-tested directly; `command-palette.tsx` is the UI over it.
 */

export interface PaletteItem {
  id: string
  /** What's matched and shown. */
  title: string
  /** Dimmed text after the title; also matched. */
  description?: string
  /** Section heading the item is listed under. */
  group: string
  icon: string
  run: () => void
}

/**
 * How well `query` matches `text`, higher is better; `null` when it doesn't.
 * A substring beats a scattered match, an earlier one beats a later one,
 * and a match at a word start (after `/`, `.`, space, `-`) gets a bonus —
 * so `users` ranks `/users/:id` above `/api/v1/superusers`.
 */
export function matchScore(query: string, text: string): number | null {
  const q = query.trim().toLowerCase()
  if (!q) return 0
  const t = text.toLowerCase()
  const at = t.indexOf(q)
  if (at >= 0) {
    const wordStart = at === 0 || /[\s/.\-_:]/.test(t[at - 1]!)
    return 1000 - at + (wordStart ? 100 : 0)
  }
  // Every character in order, possibly with gaps.
  let pos = 0
  let gaps = 0
  for (const ch of q) {
    const next = t.indexOf(ch, pos)
    if (next < 0) return null
    gaps += next - pos
    pos = next + 1
  }
  return 500 - gaps
}

/** Items matching `query`, best first; every item, in order, for an empty query. */
export function filterItems(items: readonly PaletteItem[], query: string): PaletteItem[] {
  if (!query.trim()) return [...items]
  return items
    .map((item) => {
      const title = matchScore(query, item.title)
      const description = item.description ? matchScore(query, item.description) : null
      const score = Math.max(
        title ?? -Infinity,
        description === null ? -Infinity : description - 50,
      )
      return { item, score }
    })
    .filter((x) => x.score > -Infinity)
    .toSorted((a, b) => b.score - a.score)
    .map((x) => x.item)
}
