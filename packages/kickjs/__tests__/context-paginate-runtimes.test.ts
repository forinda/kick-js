import 'reflect-metadata'
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import * as h3v2 from 'h3'

import { Application } from '../src/http/application'
import { Container } from '../src/core/container'
import { Controller, Get } from '../src/core/decorators'
import { expressRuntime } from '../src/http/runtimes/express'
import { fastifyRuntime } from '../src/http/runtimes/fastify'
import { h3Runtime } from '../src/http/runtimes/h3'
import { createWebApp } from '../src/web'
import type { HttpRuntime } from '../src/http/runtime'
import type { RequestContext } from '../src/http/context'

/**
 * `ctx.paginate` / `ctx.paginateCursor` links and cursor round-trips on every
 * engine: the links come from the request URL, which each engine exposes
 * differently (Express strips the router mount from `req.url`).
 */

const ROWS = Array.from({ length: 5 }, (_, i) => ({ id: i + 1, rank: i < 3 ? 1 : 2 }))

function makeControllers() {
  @Controller()
  class ItemsController {
    @Get('/offset')
    offset(ctx: RequestContext) {
      return ctx.paginate(async (q) => ({
        data: ROWS.slice(q.pagination.offset, q.pagination.offset + q.pagination.limit),
        total: ROWS.length,
      }))
    }

    @Get('/cursor')
    cursor(ctx: RequestContext) {
      return ctx.paginateCursor(
        async (q) => {
          // (rank, id) ascending, strictly after the cursor.
          const c = q.cursor
          const after = c
            ? ROWS.filter(
                (r) =>
                  r.rank > (c.rank as number) || (r.rank === c.rank && r.id > (c.id as number)),
              )
            : ROWS
          return after.slice(0, q.limit + 1)
        },
        { sortable: ['rank'] },
      )
    }
  }
  return ItemsController
}

const modules = () => [
  { routes: () => ({ path: '/items', controller: makeControllers() }) } as never,
]

const RUNTIMES: Array<{ name: string; make: () => HttpRuntime }> = [
  { name: 'express', make: () => expressRuntime() },
  { name: 'fastify', make: () => fastifyRuntime() },
  { name: 'h3', make: () => h3Runtime() },
]

beforeEach(() => {
  Container.reset()
})

/** Follow `links.next` from `start`, collecting ids and the status of every page. */
async function walk(get: (url: string) => Promise<{ status: number; body: any }>, start: string) {
  const ids: number[] = []
  const sizes: number[] = []
  let url: string | null = start
  while (url) {
    const res = await get(url)
    expect(res.status).toBe(200)
    ids.push(...res.body.data.map((r: { id: number }) => r.id))
    sizes.push(res.body.data.length)
    url = res.body.links.next
  }
  return { ids, sizes }
}

for (const rt of RUNTIMES) {
  describe(`pagination links — ${rt.name}`, () => {
    async function makeGet() {
      const app = new Application({ runtime: rt.make(), modules: modules() })
      await app.setup()
      return async (url: string) => {
        const res = await request(app.handle.bind(app)).get(url)
        return { status: res.status, body: res.body }
      }
    }

    it('offset links carry the full path and the other params', async () => {
      const get = await makeGet()
      const res = await get('/api/v1/items/offset?limit=2&page=2&q=x')
      expect(res.body.links).toEqual({
        self: '/api/v1/items/offset?limit=2&page=2&q=x',
        next: '/api/v1/items/offset?limit=2&q=x&page=3',
        prev: '/api/v1/items/offset?limit=2&q=x&page=1',
      })
    })

    it('cursor pages walk every row once (2, 2, 1)', async () => {
      const get = await makeGet()
      const { ids, sizes } = await walk(get, '/api/v1/items/cursor?sort=rank&limit=2')
      expect(ids).toEqual([1, 2, 3, 4, 5])
      expect(sizes).toEqual([2, 2, 1])
    })

    it('a tampered or re-sorted cursor answers 400', async () => {
      const get = await makeGet()
      const first = await get('/api/v1/items/cursor?sort=rank&limit=2')
      const cursor = first.body.meta.nextCursor as string
      expect((await get(`/api/v1/items/cursor?sort=rank&cursor=${cursor}x`)).status).toBe(400)
      expect((await get(`/api/v1/items/cursor?sort=-rank&cursor=${cursor}`)).status).toBe(400)
    })
  })
}

describe('pagination links — web entry', () => {
  it('walks cursor pages and rejects a re-sorted cursor', async () => {
    const app = createWebApp({ h3: h3v2, modules: modules() })
    const get = async (url: string) => {
      const res = await app.fetch(new Request(`http://x${url}`))
      return { status: res.status, body: await res.json() }
    }
    const { ids, sizes } = await walk(get, '/api/v1/items/cursor?sort=rank&limit=2')
    expect(ids).toEqual([1, 2, 3, 4, 5])
    expect(sizes).toEqual([2, 2, 1])

    const first = await get('/api/v1/items/cursor?sort=rank&limit=2')
    const resorted = await get(
      `/api/v1/items/cursor?sort=-rank&cursor=${first.body.meta.nextCursor}`,
    )
    expect(resorted.status).toBe(400)

    const offset = await get('/api/v1/items/offset?limit=2')
    expect(offset.body.links).toEqual({
      self: '/api/v1/items/offset?limit=2',
      next: '/api/v1/items/offset?limit=2&page=2',
      prev: null,
    })
  })
})
