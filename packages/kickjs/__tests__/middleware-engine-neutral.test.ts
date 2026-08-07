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

  it('prefers the socket over a forwarded header a direct client could forge', () => {
    // A raw Fastify / h3 request has no `req.ip`. If forwarded headers were
    // consulted first, a DIRECT client could send a different value on each
    // request and land in a fresh rate-limit bucket every time — evading the
    // limit entirely. The socket cannot be spoofed.
    expect(
      resolveClientIp({
        socket: { remoteAddress: '10.0.0.7' },
        headers: { 'x-forwarded-for': 'attacker-chosen' },
      }),
    ).toBe('10.0.0.7')
  })

  it('still reaches headers where there is no socket (edge)', () => {
    // The web/edge entry terminates the connection at the platform, so these
    // headers are the only signal that exists there.
    expect(resolveClientIp({ headers: { 'cf-connecting-ip': '198.51.100.7' } })).toBe(
      '198.51.100.7',
    )
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

describe('web Request shapes', () => {
  // No runtime hands these helpers a raw `Request` today — `WebRequestShim`
  // normalizes first on both web paths (web/handler.ts, runtimes/h3-web.ts).
  // These lock the defensive handling: `Headers` is not index-accessible and
  // `Request.url` is absolute, so BOTH would fail silently rather than throw.
  it('reads a Headers object, which has no index access', () => {
    const req = new Request('https://example.com/api/users', {
      headers: { 'x-forwarded-for': '203.0.113.5, 70.41.3.18' },
    })
    expect(resolveClientIp({ headers: req.headers })).toBe('203.0.113.5')
  })

  it('reduces an absolute Request.url to its pathname', () => {
    const req = new Request('https://example.com/health?verbose=1')
    // The bug this guards: returning the whole absolute URL means a
    // `skip: ['/health']` prefix never matches and the path is logged in full.
    expect(resolvePathname({ url: req.url })).toBe('/health')
  })

  it('still prefers a real socket address over a spoofable header', () => {
    const req = new Request('https://example.com/', {
      headers: { 'x-forwarded-for': '1.2.3.4' },
    })
    expect(resolveClientIp({ headers: req.headers, socket: { remoteAddress: '10.0.0.7' } })).toBe(
      '10.0.0.7',
    )
  })
})

describe('rateLimit — engine neutrality', () => {
  it('cannot be evaded by varying x-forwarded-for on a direct connection', async () => {
    // The same socket must land in the same bucket no matter what the client
    // claims in the header.
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
    const socket = { remoteAddress: '10.0.0.9' }
    await mw(
      { method: 'GET', url: '/a', headers: { 'x-forwarded-for': 'one' }, socket } as never,
      res as never,
      () => {},
    )
    await mw(
      { method: 'GET', url: '/a', headers: { 'x-forwarded-for': 'two' }, socket } as never,
      res as never,
      () => {},
    )
    expect(keys).toEqual(['10.0.0.9', '10.0.0.9'])
  })

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
