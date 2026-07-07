import 'reflect-metadata'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import * as h3v2 from 'h3-v2'

import { createWebApp, KvRateLimitStore, KvSessionStore, rateLimitGuard } from '../src/web'
import type { KvLike } from '../src/web'
import { Container } from '../src/core/container'
import { Controller, Get } from '../src/core/decorators'
import { defineModule } from '../src/core/define-module'
import type { RequestContext } from '../src/http/context'

/**
 * Edge-ready stores (KvLike) + the ctx-style rateLimitGuard — the pieces
 * that make session persistence and rate limiting work where in-memory
 * state dies with the isolate.
 */

/** Map-backed KvLike with real TTL semantics — what a Workers KV fake needs. */
function fakeKv(): KvLike & { size(): number } {
  const map = new Map<string, { value: string; expiresAt: number | null }>()
  return {
    async get(key) {
      const e = map.get(key)
      if (!e) return null
      if (e.expiresAt !== null && Date.now() >= e.expiresAt) {
        map.delete(key)
        return null
      }
      return e.value
    },
    async put(key, value, options) {
      map.set(key, {
        value,
        expiresAt: options?.expirationTtl ? Date.now() + options.expirationTtl * 1000 : null,
      })
    },
    async delete(key) {
      map.delete(key)
    },
    size: () => map.size,
  }
}

beforeEach(() => {
  Container.reset()
  vi.useRealTimers()
})

describe('KvRateLimitStore', () => {
  it('counts hits within the window and resets after it', async () => {
    vi.useFakeTimers()
    const store = new KvRateLimitStore(fakeKv(), { windowMs: 60_000 })
    const first = await store.increment('ip1')
    expect(first.totalHits).toBe(1)
    expect((await store.increment('ip1')).totalHits).toBe(2)
    expect((await store.increment('other')).totalHits).toBe(1)

    vi.advanceTimersByTime(61_000)
    expect((await store.increment('ip1')).totalHits).toBe(1)
  })

  it('decrement and reset behave like the in-memory store', async () => {
    const store = new KvRateLimitStore(fakeKv(), { windowMs: 60_000 })
    await store.increment('k')
    await store.increment('k')
    await store.decrement('k')
    expect((await store.increment('k')).totalHits).toBe(2)
    await store.reset('k')
    expect((await store.increment('k')).totalHits).toBe(1)
  })

  it('clamps KV TTL up to the 60s Cloudflare minimum', async () => {
    const kv = fakeKv()
    const put = vi.spyOn(kv, 'put')
    const store = new KvRateLimitStore(kv, { windowMs: 5_000 })
    await store.increment('k')
    expect(put.mock.calls[0][2]).toEqual({ expirationTtl: 60 })
  })
})

describe('KvSessionStore', () => {
  it('round-trips session data with TTL and destroys cleanly', async () => {
    const kv = fakeKv()
    const store = new KvSessionStore(kv)
    await store.set('sid1', { userId: 7 }, 3_600_000)
    expect(await store.get('sid1')).toEqual({ userId: 7 })

    await store.destroy('sid1')
    expect(await store.get('sid1')).toBeNull()
    expect(await store.get('never-set')).toBeNull()
  })

  it('touch refreshes the TTL without changing data', async () => {
    vi.useFakeTimers()
    const store = new KvSessionStore(fakeKv())
    await store.set('sid', { a: 1 }, 90_000)
    vi.advanceTimersByTime(80_000)
    await store.touch('sid', 90_000)
    vi.advanceTimersByTime(80_000) // 160s total — dead without the touch
    expect(await store.get('sid')).toEqual({ a: 1 })
  })

  it('keys are prefixed (no collision with rate-limit entries)', async () => {
    const kv = fakeKv()
    await new KvSessionStore(kv).set('x', { s: true }, 60_000)
    await new KvRateLimitStore(kv, { windowMs: 60_000 }).increment('x')
    expect(kv.size()).toBe(2)
  })
})

describe('rateLimitGuard on the web entry', () => {
  function makeApp(guard: ReturnType<typeof rateLimitGuard>) {
    @Controller()
    class PingController {
      @Get('/ping')
      async ping(ctx: RequestContext): Promise<void> {
        ctx.json({ ok: true })
      }
    }
    const mod = defineModule({
      name: 'PingModule',
      build: () => ({ routes: () => ({ path: '/p', controller: PingController }) }),
    })()
    return createWebApp({ h3: h3v2, modules: [mod], middleware: [guard] })
  }

  const req = (ip = '1.2.3.4') =>
    new Request('http://edge/api/v1/p/ping', { headers: { 'cf-connecting-ip': ip } })

  it('429s after max, with rate-limit + Retry-After headers', async () => {
    const app = makeApp(
      rateLimitGuard({
        max: 2,
        windowMs: 60_000,
        store: new KvRateLimitStore(fakeKv(), { windowMs: 60_000 }),
      }),
    )
    const ok1 = await app.fetch(req())
    expect(ok1.status).toBe(200)
    expect(ok1.headers.get('x-ratelimit-limit')).toBe('2')
    expect(ok1.headers.get('x-ratelimit-remaining')).toBe('1')

    await app.fetch(req())
    const limited = await app.fetch(req())
    expect(limited.status).toBe(429)
    expect(await limited.json()).toEqual({ message: 'Too Many Requests' })
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0)

    // Different client key — unaffected.
    expect((await app.fetch(req('9.9.9.9'))).status).toBe(200)
  })

  it('skip() bypasses limiting', async () => {
    const app = makeApp(rateLimitGuard({ max: 1, skip: () => true }))
    for (let i = 0; i < 3; i++) {
      expect((await app.fetch(req())).status).toBe(200)
    }
  })
})
