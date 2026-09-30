/**
 * The observer funnel (`onError` / `onResponse` on adapters and plugins) and
 * the diagnostics channels fed from it — on every runtime, because the
 * matched-route and error paths differ per engine.
 */
import 'reflect-metadata'
import diagnostics from 'node:diagnostics_channel'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import {
  Container,
  Controller,
  Get,
  HttpException,
  RequestContext,
  reportError,
  settleBackgroundWork,
  type AppAdapter,
  type ErrorInfo,
  type ResponseInfo,
} from '../src/index'
import { Application } from '../src/http/application'
import { hasResponseObservers, setObservers } from '../src/core/observers'
import { fastifyRuntime } from '../src/http/runtimes/fastify'
import { h3Runtime } from '../src/http/runtimes/h3'

let app: Application | undefined

beforeEach(() => {
  Container.reset()
})

afterEach(async () => {
  await app?.shutdown()
  app = undefined
  setObservers([])
  await settleBackgroundWork()
})

function recorder() {
  const errors: { error: unknown; info: ErrorInfo }[] = []
  const responses: ResponseInfo[] = []
  const adapter: AppAdapter = {
    name: 'Recorder',
    onError: (error, info) => void errors.push({ error, info }),
    onResponse: (info) => void responses.push(info),
  }
  return { adapter, errors, responses }
}

async function boot(runtime: (() => unknown) | undefined, adapters: AppAdapter[] = [], extra = {}) {
  @Controller()
  class ItemsController {
    @Get('/:id')
    get(ctx: RequestContext) {
      if (ctx.params.id === 'missing') throw new HttpException(404, 'Not here')
      if (ctx.params.id === 'boom') throw new Error('kaboom')
      if (ctx.params.id === 'later') ctx.waitUntil(Promise.reject(new Error('late failure')))
      ctx.json({ id: ctx.params.id })
    }
  }
  app = new Application({
    modules: [{ routes: () => ({ path: '/items', controller: ItemsController }) } as never],
    adapters,
    ...(runtime ? { runtime: runtime() as never } : {}),
    ...extra,
  })
  await app.setup()
  return request(app.handle.bind(app))
}

describe('reportError()', () => {
  it('reaches every observer even when one throws or rejects', async () => {
    const seen: string[] = []
    setObservers([
      {
        name: 'throws',
        onError: () => {
          throw new Error('observer bug')
        },
      },
      {
        name: 'rejects',
        onError: async () => {
          throw new Error('async observer bug')
        },
      },
      { name: 'ok', onError: (_e, info) => void seen.push(info.source) },
    ])
    expect(() => reportError(new Error('x'), { source: 'job' })).not.toThrow()
    await new Promise((r) => setTimeout(r, 0))
    expect(seen).toEqual(['job'])
  })
})

describe.each([
  ['express', undefined],
  ['fastify', fastifyRuntime],
  ['h3', h3Runtime],
] as const)('observer hooks under %s', (_name, runtime) => {
  it('onResponse gets the full route pattern, status and duration', async () => {
    const rec = recorder()
    const http = await boot(runtime, [rec.adapter])
    await http.get('/api/v1/items/42?x=1').expect(200)
    await http.get('/nowhere').expect(404)

    expect(rec.responses[0]).toMatchObject({
      method: 'GET',
      path: '/api/v1/items/42',
      route: '/api/v1/items/:id',
      status: 200,
    })
    expect(rec.responses[0].durationMs).toBeGreaterThanOrEqual(0)
    expect(rec.responses[1]).toMatchObject({ path: '/nowhere', status: 404 })
    expect(rec.responses[1].route).toBeUndefined()
  })

  it('onError gets request errors with source, route and the status they are answered with', async () => {
    const rec = recorder()
    const http = await boot(runtime, [rec.adapter])
    await http.get('/api/v1/items/boom').expect(500)
    // A handler's own 404 keeps its detail on every engine (h3 used to route
    // it to the not-found handler and drop it).
    const missing = await http.get('/api/v1/items/missing').expect(404)
    expect(missing.body.detail).toBe('Not here')

    expect(rec.errors.map((e) => e.info)).toEqual([
      expect.objectContaining({
        source: 'request',
        method: 'GET',
        route: '/api/v1/items/:id',
        status: 500,
      }),
      expect.objectContaining({ source: 'request', path: '/api/v1/items/missing', status: 404 }),
    ])
    expect((rec.errors[0].error as Error).message).toBe('kaboom')
  })

  it('onError gets failed waitUntil work with the request id', async () => {
    const rec = recorder()
    const http = await boot(runtime, [rec.adapter])
    await http.get('/api/v1/items/later').set('x-request-id', 'req-7').expect(200)
    await settleBackgroundWork()
    expect(rec.errors).toEqual([
      expect.objectContaining({
        info: expect.objectContaining({ source: 'background', requestId: 'req-7' }),
      }),
    ])
  })
})

describe('custom onError handler', () => {
  it('still receives the error after the observers', async () => {
    const rec = recorder()
    const order: string[] = []
    rec.adapter.onError = () => void order.push('observer')
    const http = await boot(undefined, [rec.adapter], {
      onError: (
        _err: unknown,
        _req: unknown,
        res: { status(n: number): { json(b: unknown): void } },
      ) => {
        order.push('handler')
        res.status(599).json({ custom: true })
      },
    })
    const res = await http.get('/api/v1/items/boom')
    expect(res.status).toBe(599)
    expect(order).toEqual(['observer', 'handler'])
  })
})

describe('diagnostics channels', () => {
  it('kickjs:handler traces the controller handler with the route pattern', async () => {
    const starts: unknown[] = []
    const ends: unknown[] = []
    const channel = diagnostics.tracingChannel('kickjs:handler')
    const handlers = {
      start: (ctx: any) =>
        starts.push({ route: ctx.route, controller: ctx.controller, handler: ctx.handler }),
      asyncEnd: (ctx: any) => ends.push(ctx.route),
    }
    channel.subscribe(handlers as never)
    try {
      const http = await boot(undefined)
      await http.get('/api/v1/items/1').expect(200)
      expect(starts).toEqual([
        { route: '/api/v1/items/:id', controller: 'ItemsController', handler: 'get' },
      ])
      expect(ends).toEqual(['/api/v1/items/:id'])
    } finally {
      channel.unsubscribe(handlers as never)
    }
  })

  it('kickjs:response and kickjs:error publish without any observer adapter', async () => {
    const responses: any[] = []
    const errors: any[] = []
    const onResponse = (msg: unknown) => void responses.push(msg)
    const onError = (msg: unknown) => void errors.push(msg)
    diagnostics.subscribe('kickjs:response', onResponse)
    diagnostics.subscribe('kickjs:error', onError)
    try {
      const http = await boot(undefined)
      await http.get('/api/v1/items/boom').expect(500)
      expect(responses).toEqual([
        expect.objectContaining({ route: '/api/v1/items/:id', status: 500 }),
      ])
      expect(errors).toEqual([
        expect.objectContaining({ source: 'request', status: 500, error: expect.any(Error) }),
      ])
    } finally {
      diagnostics.unsubscribe('kickjs:response', onResponse)
      diagnostics.unsubscribe('kickjs:error', onError)
    }
  })
})

describe('shutdown', () => {
  it('stops routing reports to the app’s adapters', async () => {
    const rec = recorder()
    await boot(undefined, [rec.adapter])
    await app!.shutdown()
    app = undefined
    reportError(new Error('after'), { source: 'job' })
    expect(rec.errors).toEqual([])
  })
})

it('only times responses while something observes them', async () => {
  await boot(undefined)
  expect(hasResponseObservers()).toBe(false)
  const listener = () => {}
  diagnostics.subscribe('kickjs:response', listener)
  expect(hasResponseObservers()).toBe(true)
  diagnostics.unsubscribe('kickjs:response', listener)
  expect(hasResponseObservers()).toBe(false)
})
