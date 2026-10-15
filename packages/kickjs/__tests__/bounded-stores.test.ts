/**
 * In-memory stores keyed by what clients send stay bounded: a flood of new
 * keys (spoofed IPs, cookieless requests) can't grow them without limit.
 */
import { describe, expect, it } from 'vitest'
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
  it('caps live keys at 100k, dropping the oldest window first', async () => {
    const store = make()
    await store.increment('first')
    await store.increment('first')
    for (let i = 0; i < 100_000; i++) await store.increment(`ip-${i}`)
    expect(sizeOf(store, field)).toBe(100_000)
    // 'first' was the oldest: evicted, so it starts a fresh window.
    expect((await store.increment('first')).totalHits).toBe(1)
    // A recent key kept its count.
    expect((await store.increment('ip-99999')).totalHits).toBe(2)
    ;(store as { dispose?: () => void }).dispose?.()
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
  it('caps sessions at 10k, dropping the least recently written', async () => {
    const store = new SessionMemoryStore()
    await store.set('kept', { n: 1 }, 60_000)
    await store.set('oldest', {}, 60_000)
    await store.touch('kept', 60_000) // now the most recent
    for (let i = 0; i < 9_999; i++) await store.set(`visitor-${i}`, {}, 60_000)
    expect(sizeOf(store, 'sessions')).toBe(10_000)
    expect(await store.get('oldest')).toBeNull()
    expect(await store.get('kept')).toEqual({ n: 1 })
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
