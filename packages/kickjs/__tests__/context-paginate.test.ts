/**
 * `ctx.paginate()` both SENDS the paginated response and RETURNS its payload.
 *
 * It used to `return this.json(response)` — handing back the engine's
 * `RuntimeResponse`. Since the documented usage is `return ctx.paginate(...)`,
 * typegen emitted `response: RuntimeResponse` into `KickRoutes` and the typed
 * client offered `.status()` / `.setHeader()` where the caller expected `data`
 * and `meta`.
 *
 * Returning the payload routes it through the same return-value inference that
 * already handles `return user` and `return reply(201, user)`, rather than
 * adding a second mechanism beside `reply`. Sending is kept so handlers that
 * call `paginate` WITHOUT returning it still respond; the runtimes only
 * auto-send a returned value when nothing was written (`if (!res.headersSent)`),
 * so there is no double send.
 */
import { describe, expect, it } from 'vitest'
import { RequestContext } from '../src/http/context'

interface Row {
  id: string
}

function makeCtx(query: Record<string, unknown> = {}) {
  const sent: unknown[] = []
  const res = {
    status: () => res,
    json: (data: unknown) => {
      sent.push(data)
      return res
    },
  }
  const req = { query, headers: {}, params: {}, body: {} } as never
  const ctx = new RequestContext(req, res as never, (() => {}) as never)
  return { ctx, sent }
}

describe('RequestContext.paginate', () => {
  it('returns the payload, not the engine response', async () => {
    const { ctx } = makeCtx()
    const result = await ctx.paginate(async () => ({
      data: [{ id: 'a' }] as Row[],
      total: 1,
    }))

    // The old return value was a RuntimeResponse — it had `status`/`json`
    // methods and no `data`.
    expect(result.data).toEqual([{ id: 'a' }])
    expect(result.meta).toMatchObject({ page: 1, total: 1, totalPages: 1 })
    expect(result).not.toHaveProperty('setHeader')
  })

  it('still sends, for handlers that do not return it', async () => {
    const { ctx, sent } = makeCtx()
    await ctx.paginate(async () => ({ data: [] as Row[], total: 0 }))
    expect(sent).toHaveLength(1)
  })

  it('sends exactly the value it returns', async () => {
    const { ctx, sent } = makeCtx()
    const result = await ctx.paginate(async () => ({ data: [{ id: 'a' }] as Row[], total: 1 }))
    expect(sent[0]).toEqual(result)
  })

  it('computes meta from the parsed query', async () => {
    const { ctx } = makeCtx({ page: '2', limit: '10' })
    const result = await ctx.paginate(async () => ({ data: [] as Row[], total: 25 }))
    expect(result.meta).toMatchObject({
      page: 2,
      limit: 10,
      total: 25,
      totalPages: 3,
      hasNext: true,
      hasPrev: true,
    })
  })

  it('passes the parsed query to the fetcher', async () => {
    const { ctx } = makeCtx({ page: '3', limit: '5' })
    // Captured directly rather than via `fetcher.mock.calls`: `vi.fn(async () =>
    // ...)` infers a ZERO-argument signature, so `calls[0][0]` types as `never`
    // and the assertion reads as passing while checking nothing.
    let seen: { pagination: { page: number; limit: number } } | undefined
    await ctx.paginate(async (parsed) => {
      seen = parsed
      return { data: [] as Row[], total: 0 }
    })
    expect(seen?.pagination).toMatchObject({ page: 3, limit: 5 })
  })
})

describe('paginate keeps the ctx.* precedence rule', () => {
  it('writes the response itself, so ctx.* still wins', async () => {
    // `ctx.*` helpers terminate the response — that is why they win over a
    // return value. `paginate` sends BEFORE returning, so the payload it
    // hands back is for inference, not a second send: the runtimes only
    // auto-send a return value when nothing was written.
    const { ctx, sent } = makeCtx()
    const result = await ctx.paginate(async () => ({ data: [] as Row[], total: 0 }))
    // Written during the call, not left to the caller to send.
    expect(sent).toHaveLength(1)
    expect(sent[0]).toBe(result)
  })
})
