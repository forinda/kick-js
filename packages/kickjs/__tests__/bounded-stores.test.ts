/**
 * In-memory stores keyed by what clients send stay bounded: a flood of new
 * keys (spoofed IPs, cookieless requests) can't grow them without limit.
 */
import { describe, expect, it, vi } from 'vitest'
import { RequestHistogram } from '../src/index'
import { MemoryStore as RateLimitMemoryStore } from '../src/http/middleware/rate-limit'
import { LazyMemoryStore } from '../src/http/middleware/rate-limit-guard'
import { BoundedCounters } from '../src/http/middleware/bounded-counters'
import { MemoryStore as SessionMemoryStore } from '../src/http/middleware/session'

const sizeOf = (store: object, field: string) =>
  (store as Record<string, Map<unknown, unknown>>)[field].size

describe('BoundedCounters (the in-memory rate-limit stores)', () => {
  it('recycles one-hit keys, so a flood of made-up keys never resets a real counter', () => {
    const counters = new BoundedCounters(60_000, 10, 5)
    for (let i = 0; i < 3; i++) counters.increment('victim')
    for (let i = 0; i < 50; i++) expect(counters.increment(`flood-${i}`).totalHits).toBe(1)
    expect(counters.size).toBe(5)
    expect(counters.increment('victim').totalHits).toBe(4)
  })

  it('refuses a new key only once every counter has two hits or more', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      const counters = new BoundedCounters(60_000, 10, 3)
      for (const key of ['a', 'b', 'c']) {
        counters.increment(key)
        counters.increment(key)
      }
      expect(counters.increment('newcomer').totalHits).toBe(Number.POSITIVE_INFINITY)
      expect(counters.increment('a').totalHits).toBe(3)
      vi.setSystemTime(Date.now() + 61_000) // the windows end
      expect(counters.increment('newcomer').totalHits).toBe(1)
      expect(counters.size).toBe(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('a counter brought back to one hit becomes evictable again', () => {
    const counters = new BoundedCounters(60_000, 10, 2)
    counters.increment('a')
    counters.increment('a')
    counters.increment('b')
    counters.increment('b')
    counters.decrement('a') // a skipped request (skipSuccessfulRequests) gave one back
    expect(counters.increment('c').totalHits).toBe(1) // took a's place
    expect(counters.increment('b').totalHits).toBe(3)
    expect(counters.increment('a').totalHits).toBe(1) // a started over
  })

  it('evicts nothing live when the limit is one: a single hit is already the limit', () => {
    const counters = new BoundedCounters(60_000, 1, 2)
    counters.increment('reset-request:alice')
    counters.increment('reset-request:bob')
    // A flood can't push alice out to buy her another request.
    expect(counters.increment('flood').totalHits).toBe(Number.POSITIVE_INFINITY)
    expect(counters.increment('reset-request:alice').totalHits).toBe(2)
  })

  it('drops expired windows from the front without touching live ones', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      const counters = new BoundedCounters(1000)
      for (let i = 0; i < 1000; i++) counters.increment(`old-${i}`)
      vi.setSystemTime(Date.now() + 1001)
      counters.increment('new')
      expect(counters.size).toBe(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it.each([
    ['rateLimit()', () => new RateLimitMemoryStore(60_000)],
    ['rateLimitGuard()', () => new LazyMemoryStore(60_000)],
  ] as const)('%s store counts through it', async (_name, make) => {
    const store = make()
    expect((await store.increment('k')).totalHits).toBe(1)
    expect((await store.increment('k')).totalHits).toBe(2)
    await store.decrement('k')
    expect((await store.increment('k')).totalHits).toBe(2)
    await store.reset('k')
    expect((await store.increment('k')).totalHits).toBe(1)
    ;(store as { dispose?: () => void }).dispose?.()
  })
})

describe('session memory store', () => {
  it('evicts empty sessions first, so a cookieless flood keeps logins', async () => {
    const store = new SessionMemoryStore()
    await store.set('logged-in', { userId: 'u1' }, 60_000)
    for (let i = 0; i < 20_000; i++) await store.set(`visitor-${i}`, {}, 60_000)
    expect(sizeOf(store, 'sessions')).toBe(10_000)
    expect(await store.get('logged-in')).toEqual({ userId: 'u1' })
    expect(await store.get('visitor-0')).toBeNull()
    expect(await store.get('visitor-19999')).toEqual({})
    store.dispose()
  })

  it('drops the least recently written once every session holds data', async () => {
    const store = new SessionMemoryStore()
    await store.set('first', { n: 1 }, 60_000)
    await store.set('second', { n: 2 }, 60_000)
    await store.touch('first', 60_000) // now more recent than 'second'
    for (let i = 0; i < 9_999; i++) await store.set(`user-${i}`, { n: i }, 60_000)
    expect(sizeOf(store, 'sessions')).toBe(10_000)
    expect(await store.get('second')).toBeNull()
    expect(await store.get('first')).toEqual({ n: 1 })
    store.dispose()
  })

  it('forgets expired empty sessions too', async () => {
    const store = new SessionMemoryStore()
    for (let i = 0; i < 100; i++) await store.set(`v-${i}`, {}, 1)
    await new Promise((done) => setTimeout(done, 5))
    for (let i = 0; i < 100; i++) await store.get(`v-${i}`)
    expect(sizeOf(store, 'empty')).toBe(0)
    store.dispose()
  })
})

it('labels an unknown HTTP method OTHER, so made-up methods add one series', () => {
  const histogram = new RequestHistogram()
  for (const method of ['FOO', 'BAR', 'get', 'GET']) {
    histogram.observe({ method, route: '/x', status: 200, durationMs: 1 })
  }
  const text = histogram.render()
  expect(text).toContain('method="OTHER"')
  expect(text).not.toContain('FOO')
  expect(text.match(/_count\{/g)).toHaveLength(2) // GET and OTHER
})
