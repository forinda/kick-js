import { describe, it, expect, vi, afterEach } from 'vitest'

import { RequestContext } from '../src/http/context'

function makeCtx(query: Record<string, unknown>): RequestContext {
  const req = { query, headers: {}, params: {}, body: {} } as never
  const res = {} as never
  const next = (() => {}) as never
  return new RequestContext(req, res, next)
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('RequestContext.qs', () => {
  it('memoizes repeat calls with the same config reference', () => {
    const ctx = makeCtx({ filter: 'status:eq:open' })
    const config = { filterable: ['status'] } as const
    const a = ctx.qs(config)
    const b = ctx.qs(config)
    expect(b).toBe(a) // identical reference — not re-parsed
  })

  it('re-parses when the config reference changes', () => {
    const ctx = makeCtx({ filter: 'status:eq:open' })
    const a = ctx.qs({ filterable: ['status'] })
    const b = ctx.qs({ filterable: ['status'] })
    expect(b).not.toBe(a)
  })

  it('warns by default when a filter field is not whitelisted', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const ctx = makeCtx({ filter: 'secret:eq:x' })
    const parsed = ctx.qs({ filterable: ['status'] })
    expect(parsed.filters).toEqual([])
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0][0]).toContain("query filter 'secret' rejected (field-not-allowed)")
  })

  it('an explicit onReject overrides the default warn (e.g. to throw a 400)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const ctx = makeCtx({ filter: 'secret:eq:x' })
    expect(() =>
      ctx.qs(
        { filterable: ['status'] },
        {
          onReject: (r) => {
            throw new Error(`bad query field: ${r.field}`)
          },
        },
      ),
    ).toThrow('bad query field: secret')
    expect(warn).not.toHaveBeenCalled()
  })

  it('honours per-call limits', () => {
    const ctx = makeCtx({ limit: '999' })
    expect(ctx.qs(undefined, { maxLimit: 25 }).pagination.limit).toBe(25)
  })
})
