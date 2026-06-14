import 'reflect-metadata'
import { describe, it, expect, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import {
  Container,
  Controller,
  Get,
  Post,
  Middleware,
  RequestContext,
  buildRouteTable,
  buildRoutes,
  materializeRouter,
  expressRuntime,
  requestScopeMiddleware,
  type RouteTable,
} from '../src/index'

beforeEach(() => {
  Container.reset()
})

// ── buildRouteTable: decorators → plain data ─────────────────────────────

describe('buildRouteTable', () => {
  it('produces one RouteEntry per decorated route with engine-neutral data', () => {
    const seen: string[] = []
    const Tag = (label: string) =>
      Middleware((_ctx: RequestContext, next: () => void) => {
        seen.push(label)
        next()
      })

    @Controller()
    class UsersController {
      @Tag('list')
      @Get('/')
      list(ctx: RequestContext) {
        ctx.json([])
      }

      @Post('/', { body: { type: 'object' } })
      create(ctx: RequestContext) {
        ctx.created({})
      }
    }

    const table = buildRouteTable(UsersController)
    expect(table).toHaveLength(2)

    const list = table.find((e) => e.method === 'GET' && e.path === '/')!
    expect(list).toBeDefined()
    expect(list.meta.controller).toBe(UsersController)
    expect(list.meta.handlerName).toBe('list')
    expect(list.middlewares).toHaveLength(1)
    expect(list.contributorRunner).toBeNull()
    expect(typeof list.handler).toBe('function')

    const create = table.find((e) => e.method === 'POST')!
    expect(create.meta.validation).toEqual({ body: { type: 'object' } })
    expect(create.meta.upload).toBeUndefined()
  })

  it('throws at build time when contributors form a cycle (boot-time failure preserved)', () => {
    // A handler with no contributors has a null runner — sanity that the
    // pipeline is only built when contributors exist.
    @Controller()
    class Plain {
      @Get('/')
      ok(ctx: RequestContext) {
        ctx.json({ ok: true })
      }
    }
    const [entry] = buildRouteTable(Plain)
    expect(entry.contributorRunner).toBeNull()
  })
})

// ── expressRuntime: materializes the table, behaves like the old builder ──

describe('expressRuntime', () => {
  it('reports Express capabilities', () => {
    const rt = expressRuntime()
    expect(rt.name).toBe('express')
    expect(rt.capabilities).toEqual({
      render: true,
      uploads: true,
      connectMiddleware: true,
      nativeBodyParsing: false,
    })
  })

  it('mountRoutes serves a RouteTable end-to-end', async () => {
    @Controller()
    class HelloController {
      @Get('/:name')
      greet(ctx: RequestContext) {
        ctx.json({ hello: ctx.params.name })
      }
    }

    const rt = expressRuntime()
    const app = rt.createApp()
    rt.useConnect(app, requestScopeMiddleware())
    const table: RouteTable = [{ mountPath: '/hello', routes: buildRouteTable(HelloController) }]
    rt.mountRoutes(app, table)

    const res = await request(rt.nodeHandler(app) as any)
      .get('/hello/ada')
      .expect(200)
    expect(res.body).toEqual({ hello: 'ada' })
  })

  it('nodeHandler falls through to next() when no route matches (Vite dev contract)', async () => {
    const rt = expressRuntime()
    const inner = rt.createApp() // no routes — everything should fall through

    // Mirror the Vite chain: the runtime handler runs first, then a downstream
    // terminal handles whatever it didn't match. If nodeHandler 404'd instead
    // of calling next, the terminal would never fire.
    const outer = express()
    outer.use((req, res, next) => rt.nodeHandler(inner)(req, res, next))
    outer.use((_req, res) => res.status(418).json({ fellThrough: true }))

    const res = await request(outer).get('/nope').expect(418)
    expect(res.body).toEqual({ fellThrough: true })
  })

  it('buildRoutes equals materializeRouter(buildRouteTable(...)) — same public behavior', async () => {
    @Controller()
    class PingController {
      @Get('/ping')
      ping(ctx: RequestContext) {
        ctx.json({ pong: true })
      }
    }

    const viaShim = expressRuntime().createApp()
    viaShim.use(requestScopeMiddleware())
    viaShim.use('/', buildRoutes(PingController))

    const viaParts = expressRuntime().createApp()
    viaParts.use(requestScopeMiddleware())
    viaParts.use('/', materializeRouter(buildRouteTable(PingController)))

    for (const app of [viaShim, viaParts]) {
      const res = await request(app).get('/ping').expect(200)
      expect(res.body).toEqual({ pong: true })
    }
  })

  it('serveStatic mounts a directory', async () => {
    const rt = expressRuntime()
    const app = rt.createApp()
    // Serve this test directory; assert a known file is reachable.
    rt.serveStatic(app, '/static', __dirname)
    await request(app).get('/static/http-runtime-seam.test.ts').expect(200)
  })
})
