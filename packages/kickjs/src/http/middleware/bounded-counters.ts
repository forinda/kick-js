/**
 * Per-key hit counters for a fixed window, in memory, bounded — the core of
 * the in-memory rate-limit stores. Keys come from clients (an IP, a header
 * behind a proxy, a username from a custom key), so the map is capped, and
 * what happens at the cap decides who a flood of new keys can hurt:
 *
 * - Expired windows go first. The map is kept in window order (a key starting
 *   a new window moves to the back), so they are always at the front, and a
 *   sweep stops at the first live one — no full scan.
 * - Then a counter still at one hit, oldest first — when the limit is above
 *   one, so a single hit is below it. A flood of single requests from made-up
 *   keys just recycles itself; a counter a client has hit twice (a username
 *   with failed logins) is never pushed out, so flooding can't reset it. At
 *   most it costs a key one hit, while that key is at one. With a limit of
 *   one, a single hit is already the limit, so nothing live is evicted.
 * - Only when every counter is at two or more is a new key refused, counted
 *   as over any limit until the oldest window ends. Reaching that takes two
 *   requests per key across the whole cap within one window.
 *
 * @internal
 */
export class BoundedCounters {
  private readonly hits = new Map<string, { hits: number; reset: number }>()
  /** Keys at one hit (or fewer), oldest first: the only ones evicted. */
  private readonly singles = new Set<string>()

  /**
   * @param limit The rate limit these counters enforce (`max`): one-hit
   * counters are only evictable while that's below it.
   */
  constructor(
    private readonly windowMs: number,
    private readonly limit = Number.POSITIVE_INFINITY,
    // ponytail: fixed cap; a store shared between instances (Redis) has its own limits.
    private readonly max = 100_000,
  ) {}

  get size(): number {
    return this.hits.size
  }

  increment(key: string): { totalHits: number; resetTime: Date } {
    const now = Date.now()
    const entry = this.hits.get(key)
    if (entry && entry.reset > now) {
      entry.hits++
      if (entry.hits > 1) this.singles.delete(key)
      return { totalHits: entry.hits, resetTime: new Date(entry.reset) }
    }
    this.remove(key)
    this.sweep(now)
    if (this.hits.size >= this.max) {
      const single = this.limit > 1 ? this.singles.values().next().value : undefined
      if (single === undefined) {
        const oldest = this.hits.values().next().value!
        return { totalHits: Number.POSITIVE_INFINITY, resetTime: new Date(oldest.reset) }
      }
      this.remove(single)
    }
    const fresh = { hits: 1, reset: now + this.windowMs }
    this.hits.set(key, fresh)
    this.singles.add(key)
    return { totalHits: 1, resetTime: new Date(fresh.reset) }
  }

  decrement(key: string): void {
    const entry = this.hits.get(key)
    if (!entry || entry.hits === 0) return
    entry.hits--
    if (entry.hits <= 1) this.singles.add(key)
  }

  reset(key: string): void {
    this.remove(key)
  }

  /** Drop expired windows, from the front. */
  sweep(now = Date.now()): void {
    for (const [key, entry] of this.hits) {
      if (entry.reset > now) break
      this.remove(key)
    }
  }

  clear(): void {
    this.hits.clear()
    this.singles.clear()
  }

  private remove(key: string): void {
    this.hits.delete(key)
    this.singles.delete(key)
  }
}
