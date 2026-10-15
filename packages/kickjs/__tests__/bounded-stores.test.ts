/**
 * In-memory stores keyed by what clients send stay bounded: a flood of new
 * keys (spoofed IPs, cookieless requests) can't grow them without limit.
 */
import { describe, expect, it, vi } from 'vitest'
import { RequestHistogram } from '../src/index'
import { MemoryStore as RateLimitMemoryStore } from '../src/http/middleware/rate-limit'
import { LazyMemoryStore } from '../src/http/middleware/rate-limit-guard'
import { MemoryStore as SessionMemoryStore } from '../src/http/middleware/session'

const sizeOf = (store: object, field: string) =>
  (store as Record<string, Map<unknown, unknown>>)[field].size

describe.each([
  ['rateLimit() memory store', () => new RateLimitMemoryStore(60_000), 'hits'],
  ['rateLimitGuard() memory store', () => new LazyMemoryStore(60_000), 'hits'],
] as const)('%s', (_name, make, field) => {
  it('caps live keys at 100k, refusing new keys rather than dropping a live counter', async () => {
    const store = make()
    await store.increment('victim')
    await store.increment('victim')
    for (let i = 0; i < 99_999; i++) await store.increment(`flood-${i}`)
    expect(sizeOf(store, field)).toBe(100_000)
    // Full: a new key is over any limit, and the victim's count survives.
    expect((await store.increment('newcomer')).totalHits).toBe(Number.POSITIVE_INFINITY)
    expect((await store.increment('victim')).totalHits).toBe(3)
    expect(sizeOf(store, field)).toBe(100_000)
    ;(store as { dispose?: () => void }).dispose?.()
  })

  it('takes new keys again once windows end', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      const store = make()
      for (let i = 0; i < 100_000; i++) await store.increment(`flood-${i}`)
      expect((await store.increment('newcomer')).totalHits).toBe(Number.POSITIVE_INFINITY)
      vi.setSystemTime(Date.now() + 61_000) // past the 60s window
      expect((await store.increment('newcomer')).totalHits).toBe(1)
      ;(store as { dispose?: () => void }).dispose?.()
    } finally {
      vi.useRealTimers()
    }
  })

  it('drops expired windows from the front without scanning live ones', async () => {
    const store = new (make().constructor as new (windowMs: number) => typeof store)(1)
    for (let i = 0; i < 1000; i++) await store.increment(`old-${i}`)
    await new Promise((done) => setTimeout(done, 5))
    await store.increment('new')
    expect(sizeOf(store, field)).toBe(1)
    ;(store as { dispose?: () => void }).dispose?.()
  })
})

describe('session memory store', () => {
  it('evicts empty sessions first, so a cookieless flood keeps logins', async () => {
    const store = new SessionMemoryStore()
    await store.set('logged-in', { userId: 1 }, 60_000)
    for (let i = 0; i < 20_000; i++) await store.set(`visitor-${i}`, {}, 60_000)
    expect(sizeOf(store, 'sessions')).toBe(10_000)
    expect(await store.get('logged-in')).toEqual({ userId: 1 })
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
