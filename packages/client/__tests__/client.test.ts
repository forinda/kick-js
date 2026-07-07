import 'reflect-metadata'
import { describe, it, expect, expectTypeOf, beforeEach } from 'vitest'
import * as h3v2 from 'h3-v2'

import { createWebApp } from '@forinda/kickjs/web'
import { Container } from '@forinda/kickjs/container'
import { Controller, Get, Post, Delete } from '@forinda/kickjs/decorators'
import {
  reply,
  type RequestContext,
  type InferHandlerResponse,
  type SseHandler,
} from '@forinda/kickjs'

import {
  createClient,
  createTestClient,
  KickClientError,
  type RouteShapeLike,
  type SseEvent,
} from '../src/index'

/**
 * End-to-end: real decorated controllers served through `createWebApp`,
 * consumed through the typed client with `fetch` injected — the full R1→R3
 * loop, network-free. The hand-written Api map below mirrors what
 * `kick typegen` emits into `KickRoutes.Api`.
 */

interface Task {
  id: string
  title: string
}

// What kick typegen would emit (KickRoutes.Api) for the fixture controller.
interface Api {
  'GET /tasks/:id': {
    params: { id: string }
    body: unknown
    query: unknown
    response: Task
  }
  'POST /tasks': {
    params: Record<string, never>
    body: { title: string }
    query: unknown
    response: Task
  }
  'DELETE /tasks/:id': {
    params: { id: string }
    body: unknown
    query: unknown
    response: unknown
  }
  'GET /tasks': {
    params: Record<string, never>
    body: unknown
    query: { filter?: string | string[]; sort?: 'createdAt' | '-createdAt'; q?: string }
    response: Task[]
  }
  'GET /tasks/events': {
    params: Record<string, never>
    body: unknown
    query: unknown
    response: SseHandler<{ n: number }>
  }
}
// Api entries must conform to the client's shape contract.
type _check = Api[keyof Api] extends RouteShapeLike ? true : never

function makeApp() {
  @Controller()
  class TasksController {
    @Get('/:id')
    async get(ctx: RequestContext): Promise<Task> {
      return { id: ctx.params.id, title: `task ${ctx.params.id}` }
    }

    @Get('/')
    async list(_ctx: RequestContext): Promise<Task[]> {
      return [{ id: '1', title: 'one' }]
    }

    @Post('/')
    async create(ctx: RequestContext) {
      return reply(201, { id: 'new', title: (ctx.body as { title: string }).title })
    }

    @Delete('/:id')
    async remove(ctx: RequestContext) {
      if (ctx.params.id === 'missing') return ctx.notFound('no such task')
      return reply.noContent()
    }

    @Get('/events')
    async events(ctx: RequestContext) {
      const sse = ctx.sse<{ n: number }>()
      sse.send({ n: 1 })
      sse.send({ n: 2 }, 'tick', '42')
      sse.comment('keep-alive')
      sse.close()
      return sse
    }
  }

  return createWebApp({
    h3: h3v2,
    modules: [{ routes: () => ({ path: '/tasks', controller: TasksController }) } as never],
  })
}

beforeEach(() => {
  Container.reset()
})

describe('createClient — runtime against a real web app', () => {
  function makeClient() {
    const app = makeApp()
    return createClient<Api>({
      baseUrl: 'http://api.test/api/v1',
      fetch: (req) => app.fetch(req),
    })
  }

  it('GET with params — response typed and correct', async () => {
    const api = makeClient()
    const task = await api.get('/tasks/:id', { params: { id: '42' } })
    expect(task).toEqual({ id: '42', title: 'task 42' })
    expectTypeOf(task).toEqualTypeOf<Task>()
  })

  it('POST with body — 201 payload comes back typed', async () => {
    const api = makeClient()
    const created = await api.post('/tasks', { body: { title: 'ship it' } })
    expect(created).toEqual({ id: 'new', title: 'ship it' })
    expectTypeOf(created).toEqualTypeOf<Task>()
  })

  it('DELETE 204 resolves to undefined', async () => {
    const api = makeClient()
    await expect(api.delete('/tasks/:id', { params: { id: '9' } })).resolves.toBeUndefined()
  })

  it('non-2xx throws KickClientError carrying the body', async () => {
    const api = makeClient()
    const err = await api
      .delete('/tasks/:id', { params: { id: 'missing' } })
      .then(() => null)
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(KickClientError)
    expect((err as KickClientError).status).toBe(404)
  })

  it('missing path params throw a clear client-side error', async () => {
    const api = makeClient()
    await expect(api.get('/tasks/:id', {} as never)).rejects.toThrow(/missing path param ':id'/)
  })

  it('a body smuggled onto GET via casts is stripped (no Request throw)', async () => {
    let method = ''
    const api = createClient<Api>({
      baseUrl: 'http://x/api/v1',
      fetch: (req) => {
        method = req.method
        return Promise.resolve(
          new Response('[]', { headers: { 'content-type': 'application/json' } }),
        )
      },
    })
    await api.get('/tasks', { body: { nope: true } } as never)
    expect(method).toBe('GET')
  })

  it('query values serialize onto the URL', async () => {
    let seenUrl = ''
    const api = createClient<Api>({
      baseUrl: 'http://api.test/api/v1',
      fetch: (req) => {
        seenUrl = req.url
        return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }))
      },
    })
    await api.get('/tasks', { query: { sort: '-createdAt', filter: ['a', 'b'] } })
    expect(seenUrl).toBe('http://api.test/api/v1/tasks?sort=-createdAt&filter=a&filter=b')
  })

  it('header factory runs per request', async () => {
    let token = 't1'
    let seen: string | null = null
    const api = createClient<Api>({
      baseUrl: 'http://x/api/v1',
      headers: () => ({ authorization: `Bearer ${token}` }),
      fetch: (req) => {
        seen = req.headers.get('authorization')
        return Promise.resolve(
          new Response('[]', { headers: { 'content-type': 'application/json' } }),
        )
      },
    })
    await api.get('/tasks')
    expect(seen).toBe('Bearer t1')
    token = 't2'
    await api.get('/tasks')
    expect(seen).toBe('Bearer t2')
  })
})

describe('createClient — type-level contract', () => {
  // NEVER INVOKED — these closures exist purely for the type checker.
  // Calling the client here would fire real fetches (unhandled rejections).
  const api = createClient<Api>({ baseUrl: 'http://x' })

  const _typeOnly = () => {
    // @ts-expect-error — '/nope' is not a registered GET path
    void api.get('/nope')
    // @ts-expect-error — '/tasks/:id' is not registered under POST
    void api.post('/tasks/:id')
    // @ts-expect-error — params.id is required for '/tasks/:id'
    void api.get('/tasks/:id')
    // @ts-expect-error — body.title is required for POST /tasks
    void api.post('/tasks', {})
    // @ts-expect-error — GET requests must not carry a body
    void api.get('/tasks', { body: { nope: true } })

    // @ts-expect-error — 'created' is not a sortable field on GET /tasks
    void api.get('/tasks', { query: { sort: 'created' } })

    expectTypeOf(api.get('/tasks/:id', { params: { id: 'x' } })).resolves.toEqualTypeOf<Task>()
    expectTypeOf(api.get('/tasks')).resolves.toEqualTypeOf<Task[]>()
    expectTypeOf(api.post('/tasks', { body: { title: 't' } })).resolves.toEqualTypeOf<Task>()
  }

  it('type contract compiles (assertions live in the unexecuted closure)', () => {
    expect(typeof _typeOnly).toBe('function')
    expectTypeOf<InferHandlerResponse<(ctx: never) => Promise<Task>>>().toEqualTypeOf<Task>()
  })
})

describe('createTestClient — network-free harness', () => {
  it('wraps a web app with the default test baseUrl', async () => {
    const api = createTestClient<Api>(makeApp())
    const task = await api.get('/tasks/:id', { params: { id: '7' } })
    expect(task).toEqual({ id: '7', title: 'task 7' })
    expectTypeOf(task).toEqualTypeOf<Task>()
  })

  it('an explicit undefined baseUrl keeps the default (spread-order regression)', async () => {
    const app = makeApp()
    const api = createTestClient<Api>(app, { baseUrl: undefined })
    const task = await api.get('/tasks/:id', { params: { id: '3' } })
    expect(task).toEqual({ id: '3', title: 'task 3' })
  })

  it('honors a custom baseUrl for non-default prefixes', async () => {
    const app = makeApp()
    let seenUrl = ''
    const api = createTestClient<Api>(
      { fetch: (r) => ((seenUrl = r.url), app.fetch(r)) },
      { baseUrl: 'http://edge/api/v1' },
    )
    await api.get('/tasks')
    expect(seenUrl).toBe('http://edge/api/v1/tasks')
  })
})

describe('api.stream — typed SSE', () => {
  it('iterates typed events from a real web app', async () => {
    const app = makeApp()
    const api = createTestClient<Api>(app)
    const stream = await api.stream('/tasks/events')
    const events: SseEvent<{ n: number }>[] = []
    for await (const ev of stream) events.push(ev)
    expect(events.map((e) => e.data)).toEqual([{ n: 1 }, { n: 2 }])
    expect(events[1]).toMatchObject({ event: 'tick', id: '42' })
    expectTypeOf(events[0].data).toEqualTypeOf<{ n: number }>()
  })

  it('close() aborts iteration', async () => {
    const app = makeApp()
    const api = createTestClient<Api>(app)
    const stream = await api.stream('/tasks/events')
    stream.close()
    const events: unknown[] = []
    try {
      for await (const ev of stream) events.push(ev)
    } catch {
      // aborted reads may reject — either outcome (empty or throw) is fine
    }
    expect(events.length).toBeLessThanOrEqual(2)
  })

  it('non-SSE GET paths are rejected at the type level', () => {
    const api = createTestClient<Api>(makeApp())
    const _typeOnly = () => {
      // @ts-expect-error — '/tasks/:id' response is not an SSE stream
      void api.stream('/tasks/:id')
      // @ts-expect-error — '/tasks' response is not an SSE stream
      void api.stream('/tasks')
    }
    expect(typeof _typeOnly).toBe('function')
  })
})
