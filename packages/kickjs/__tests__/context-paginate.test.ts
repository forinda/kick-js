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

function makeCtx(query: Record<string, unknown> = {}, url = '/items') {
  const sent: unknown[] = []
  const res = {
    status: () => res,
    json: (data: unknown) => {
      sent.push(data)
      return res
    },
  }
  const req = { query, url, headers: {}, params: {}, body: {} } as never
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

describe('paginate links', () => {
  it('links to neighbours, keeping other params, null at the ends', async () => {
    const { ctx } = makeCtx({ page: '2', limit: '10' }, '/items?filter=a%3Aeq%3Ab&page=2&limit=10')
    const result = await ctx.paginate(async () => ({ data: [] as Row[], total: 25 }))
    expect(result.links).toEqual({
      self: '/items?filter=a%3Aeq%3Ab&page=2&limit=10',
      next: '/items?filter=a%3Aeq%3Ab&limit=10&page=3',
      prev: '/items?filter=a%3Aeq%3Ab&limit=10&page=1',
    })
  })

  it('has no prev on the first page and no next on the last', async () => {
    const { ctx } = makeCtx({}, '/items')
    const result = await ctx.paginate(async () => ({ data: [] as Row[], total: 3 }))
    expect(result.links).toEqual({ self: '/items', next: null, prev: null })
  })

  it('never carries a host, even from an absolute-form request target', async () => {
    const { ctx } = makeCtx({ page: '1' }, 'http://evil.example//items?page=1')
    const result = await ctx.paginate(async () => ({ data: [] as Row[], total: 100 }))
    expect(result.links).toMatchObject({ self: '/items?page=1', next: '/items?page=2' })
    const viaPath = makeCtx({}, '//evil.example/items').ctx
    const links = (await viaPath.paginate(async () => ({ data: [] as Row[], total: 0 }))).links
    expect(links.self).toBe('/items')
  })
})

interface Post {
  id: number
  createdAt: string
}

// Ten rows; createdAt repeats so the id tie-breaker matters.
const POSTS: Post[] = Array.from({ length: 10 }, (_, i) => ({
  id: i + 1,
  createdAt: `2026-01-0${Math.floor(i / 3) + 1}`,
}))

/** Keyset fetch the way a database would: (createdAt, id) DESC, strictly after the cursor. */
function fetchDesc(q: { cursor: Record<string, unknown> | null; limit: number }): Post[] {
  const sorted = POSTS.toSorted((a, b) =>
    a.createdAt === b.createdAt ? b.id - a.id : b.createdAt.localeCompare(a.createdAt),
  )
  const c = q.cursor
  const after = c
    ? sorted.filter(
        (p) =>
          p.createdAt < (c.createdAt as string) ||
          (p.createdAt === c.createdAt && p.id < (c.id as number)),
      )
    : sorted
  return after.slice(0, q.limit + 1)
}

describe('RequestContext.paginateCursor', () => {
  const config = { sortable: ['createdAt'] }

  async function page(query: Record<string, unknown>, url: string) {
    const { ctx, sent } = makeCtx(query, url)
    const result = await ctx.paginateCursor(async (q) => fetchDesc(q), config)
    return { result, sent }
  }

  it('walks every row once, in order, following links.next', async () => {
    const seen: number[] = []
    let url: string | null = '/posts?sort=-createdAt&limit=3'
    let pages = 0
    while (url) {
      const query = Object.fromEntries(new URL(url, 'http://x').searchParams)
      const { result } = await page(query, url)
      seen.push(...result.data.map((p) => p.id))
      expect(result.meta.hasNext).toBe(result.links.next !== null)
      expect(result.meta.nextCursor === null).toBe(result.links.next === null)
      url = result.links.next
      pages++
    }
    expect(pages).toBe(4)
    expect(seen).toEqual(fetchDesc({ cursor: null, limit: 99 }).map((p) => p.id))
  })

  it('trims the extra row and reports the shape', async () => {
    const { result, sent } = await page(
      { sort: '-createdAt', limit: '4' },
      '/posts?sort=-createdAt&limit=4',
    )
    expect(result.data).toHaveLength(4)
    expect(result.meta).toMatchObject({ limit: 4, hasNext: true })
    expect(result.links.self).toBe('/posts?sort=-createdAt&limit=4')
    expect(result.links.next).toBe(
      `/posts?sort=-createdAt&limit=4&cursor=${result.meta.nextCursor}`,
    )
    expect(sent[0]).toBe(result)
  })

  it('hands the fetcher the decoded position, not the raw cursor', async () => {
    const first = await page({ sort: '-createdAt', limit: '2' }, '/posts')
    const { ctx } = makeCtx({
      sort: '-createdAt',
      limit: '2',
      cursor: first.result.meta.nextCursor,
    })
    let seen: unknown
    await ctx.paginateCursor(async (q) => {
      seen = q.cursor
      return []
    }, config)
    const last = first.result.data[1]
    expect(seen).toEqual({ createdAt: last.createdAt, id: last.id })
  })

  it('has no next on the last page', async () => {
    const { result } = await page({ limit: '50' }, '/posts?limit=50')
    expect(result.meta).toEqual({ limit: 50, hasNext: false, nextCursor: null })
    expect(result.links.next).toBeNull()
  })

  it.each([
    ['not base64url', '***'],
    ['not JSON', btoa('nope').replace(/=+$/, '')],
    ['wrong shape', btoa(JSON.stringify({ v: [1], s: 'createdAt:desc' })).replace(/=+$/, '')],
    [
      'nested value',
      btoa(JSON.stringify({ v: { createdAt: { $gt: '' }, id: 1 }, s: 'createdAt:desc' })).replace(
        /=+$/,
        '',
      ),
    ],
    ['missing key', btoa(JSON.stringify({ v: { id: 1 }, s: 'createdAt:desc' })).replace(/=+$/, '')],
    ['repeated param', ['a', 'b']],
  ])('answers 400 for a malformed cursor (%s)', async (_label, cursor) => {
    const { ctx } = makeCtx({ sort: '-createdAt', cursor })
    const fetcher = async () => [] as Post[]
    await expect(ctx.paginateCursor(fetcher, config)).rejects.toMatchObject({
      status: 400,
      message: 'Invalid pagination cursor',
    })
  })

  it('answers 400 for a cursor issued under a different sort', async () => {
    const first = await page({ sort: '-createdAt', limit: '2' }, '/posts')
    const { ctx } = makeCtx({ sort: 'createdAt', cursor: first.result.meta.nextCursor })
    await expect(ctx.paginateCursor(async () => [] as Post[], config)).rejects.toMatchObject({
      status: 400,
    })
  })

  it('uses idField and cursorKey when given', async () => {
    const rows = [{ uuid: 'a' }, { uuid: 'b' }, { uuid: 'c' }]
    const { ctx } = makeCtx({ limit: '2' })
    const byId = await ctx.paginateCursor(async () => rows, undefined, { idField: 'uuid' })
    const next = makeCtx({ limit: '2', cursor: byId.meta.nextCursor }).ctx
    let seen: unknown
    await next.paginateCursor(
      async (q) => {
        seen = q.cursor
        return []
      },
      undefined,
      { idField: 'uuid' },
    )
    expect(seen).toEqual({ uuid: 'b' })

    const custom = await makeCtx({ limit: '1' }).ctx.paginateCursor(async () => rows, undefined, {
      cursorKey: (r) => ({ k: r.uuid.toUpperCase() }),
    })
    const decoded = JSON.parse(atob(custom.meta.nextCursor!.replace(/-/g, '+').replace(/_/g, '/')))
    expect(decoded).toEqual({ v: { k: 'A' }, s: '' })
  })

  it('fails loudly when a row lacks a cursor field', async () => {
    const { ctx } = makeCtx({ limit: '1' })
    await expect(ctx.paginateCursor(async () => [{ name: 'x' }, { name: 'y' }])).rejects.toThrow(
      /row has no 'id'/,
    )
  })
})
