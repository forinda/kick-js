/**
 * `ctx.ip` and `ctx.redirect()` — the two engine-neutral accessors the guide
 * previously had no way to express.
 *
 * `ctx.req.ip` is Express-only, and `ctx.res.redirect()` exists on Express and
 * Fastify but not h3, so the docs had to carry "this breaks on X" caveats
 * instead of showing portable code.
 */
import { describe, expect, it } from 'vitest'
import { RequestContext } from '../src/http/context'

function makeCtx(req: Record<string, unknown>) {
  const calls: Array<[string, unknown]> = []
  const res = {
    status(code: number) {
      calls.push(['status', code])
      return res
    },
    setHeader(name: string, value: unknown) {
      calls.push([`header:${name}`, value])
      return res
    },
    end(data?: unknown) {
      calls.push(['end', data])
      return res
    },
    json: () => res,
  }
  const ctx = new RequestContext(
    { headers: {}, params: {}, query: {}, body: {}, ...req } as never,
    res as never,
    (() => {}) as never,
  )
  return { ctx, calls }
}

describe('ctx.ip', () => {
  it('prefers the address the runtime computed', () => {
    // Express derives `req.ip` from `trust proxy`; Fastify from `trustProxy`.
    // That is the value that has actually been vetted.
    const { ctx } = makeCtx({ ip: '203.0.113.9', headers: { 'x-forwarded-for': '10.0.0.1' } })
    expect(ctx.ip).toBe('203.0.113.9')
  })

  it('does not let a forwarded header override a computed address', () => {
    // Raw forwarded headers are client-spoofable. Preferring them would let a
    // caller pick their own rate-limit bucket or audit identity.
    const { ctx } = makeCtx({ ip: '203.0.113.9', headers: { 'x-forwarded-for': '1.2.3.4' } })
    expect(ctx.ip).not.toBe('1.2.3.4')
  })

  it('falls back to forwarded headers only when the runtime computed none', () => {
    // The web/edge entry has no `ip` field at all.
    const { ctx } = makeCtx({ headers: { 'cf-connecting-ip': '198.51.100.7' } })
    expect(ctx.ip).toBe('198.51.100.7')
  })

  it('takes the first hop of a comma-separated forwarded chain', () => {
    const { ctx } = makeCtx({ headers: { 'x-forwarded-for': '198.51.100.7, 10.0.0.1' } })
    expect(ctx.ip).toBe('198.51.100.7')
  })

  it('falls back to the node socket', () => {
    // Fastify/h3 raw requests when no proxy header is present.
    const { ctx } = makeCtx({ socket: { remoteAddress: '192.0.2.5' } })
    expect(ctx.ip).toBe('192.0.2.5')
  })

  it('is undefined when nothing can determine it', () => {
    const { ctx } = makeCtx({})
    expect(ctx.ip).toBeUndefined()
  })
})

describe('ctx.redirect', () => {
  it('writes status and Location through the runtime surface', () => {
    // Not `ctx.res.redirect()` — h3's event has no such method.
    const { ctx, calls } = makeCtx({})
    ctx.redirect('/login')
    expect(calls).toEqual([
      ['status', 302],
      ['header:location', '/login'],
      ['end', undefined],
    ])
  })

  it('accepts an explicit status', () => {
    const { ctx, calls } = makeCtx({})
    ctx.redirect('https://example.com/next', 301)
    expect(calls[0]).toEqual(['status', 301])
  })
})
