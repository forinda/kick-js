/**
 * Connect-style middleware receives the RAW node request under Fastify and h3,
 * so the Express conveniences (`req.ip`, `req.path`) are `undefined` there.
 * Three shipped middlewares read them directly:
 *
 *   rateLimit  → every caller keyed as the `'127.0.0.1'` fallback: ONE shared
 *                bucket, so a single client could exhaust the limit for
 *                everyone
 *   csrf       → `ignorePaths` never matched, so configured exemptions were
 *                silently dead (fails closed, but the feature did nothing)
 *   requestLogger → covered in its own file
 */
import { describe, expect, it } from 'vitest'
import { rateLimit } from '../src/http/middleware/rate-limit'
import { csrf } from '../src/http/middleware/csrf'
import { resolveClientIp, resolvePathname } from '../src/http/client-ip'

/** Fastify / h3 shape: raw node request. */
const raw = (url: string, method = 'GET', extra: object = {}) =>
  ({ method, url, headers: {}, ...extra }) as never

describe('resolveClientIp', () => {
  it('prefers the runtime-computed address over a spoofable header', () => {
    expect(resolveClientIp({ ip: '203.0.113.9', headers: { 'x-forwarded-for': '1.2.3.4' } })).toBe(
      '203.0.113.9',
    )
  })

  it('uses the socket when no proxy header and no computed address', () => {
    expect(resolveClientIp({ socket: { remoteAddress: '10.0.0.7' } })).toBe('10.0.0.7')
  })
})

describe('resolvePathname', () => {
  it('strips the query string from a raw url', () => {
    expect(resolvePathname({ url: '/health?verbose=1' })).toBe('/health')
  })

  it('prefers Express req.path when present', () => {
    expect(resolvePathname({ path: '/health', url: '/health?x=1' })).toBe('/health')
  })
})

describe('rateLimit — engine neutrality', () => {
  it('keys distinct clients separately on a raw node request', async () => {
    const keys: string[] = []
    const mw = rateLimit({
      max: 100,
      store: {
        increment: async (k: string) => (keys.push(k), { totalHits: 1, resetTime: new Date() }),
        decrement: async () => {},
        reset: async () => {},
      } as never,
    })
    const res = { setHeader: () => {}, status: () => res, json: () => {} }
    await mw(raw('/a', 'GET', { socket: { remoteAddress: '10.0.0.1' } }), res as never, () => {})
    await mw(raw('/b', 'GET', { socket: { remoteAddress: '10.0.0.2' } }), res as never, () => {})

    // Previously both were '127.0.0.1' — a single shared bucket.
    expect(keys).toEqual(['10.0.0.1', '10.0.0.2'])
  })

  it('honours skipPaths on a raw node request', async () => {
    let nexted = false
    const mw = rateLimit({ skipPaths: ['/health'] })
    const res = { setHeader: () => {}, status: () => res, json: () => {} }
    await mw(raw('/health'), res as never, () => {
      nexted = true
    })
    expect(nexted).toBe(true)
  })
})

describe('csrf — engine neutrality', () => {
  it('honours ignorePaths on a raw node request', () => {
    let nexted = false
    const mw = csrf({ ignorePaths: ['/webhook'] })
    const res = { status: () => res, json: () => {}, setHeader: () => {}, cookie: () => {} }
    mw(
      raw('/webhook', 'POST', { cookies: {} }),
      res as never,
      (() => {
        nexted = true
      }) as never,
    )
    expect(nexted).toBe(true)
  })
})
