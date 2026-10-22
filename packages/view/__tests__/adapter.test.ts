import 'reflect-metadata'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import ejs from 'ejs'
import request from 'supertest'
import * as h3v2 from 'h3'
import { beforeEach, describe, expect, it } from 'vitest'
import { fastifyRuntime } from '@forinda/kickjs/fastify'
import { h3Runtime } from '@forinda/kickjs/h3'
import { createWebApp } from '@forinda/kickjs/web'
import {
  Application,
  Container,
  Controller,
  Get,
  ViewAdapter,
  defineModule,
  expressRuntime,
  type RequestContext,
} from '@forinda/kickjs'
import { KickView, createViews, viewsMiddleware, type Views } from '../src/index'

function viewsDir(files: Record<string, string>, ext = 'kick'): string {
  const root = mkdtempSync(join(tmpdir(), 'kick-view-app-'))
  for (const [name, src] of Object.entries(files)) {
    const file = join(root, name.includes('.') ? name : `${name}.${ext}`)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, src)
  }
  return root
}

const FILES = {
  home: '<h1>Hi {{ n }}</h1>{{ id ?? "" }}',
  'layouts/main': '<main><slot /></main>',
  broken: '{{ x | json }}',
  'errors/404': '<h1>Not here {{ path }}</h1>',
}

@Controller()
class PagesController {
  @Get('/home')
  async home(ctx: RequestContext) {
    await ctx.render('home', { n: 'Ada' })
  }
  @Get('/created')
  async created(ctx: RequestContext) {
    await ctx.render('home', { n: 'B' }, { status: 201, headers: { 'x-a': '1' } })
  }
  @Get('/partial')
  async partial(ctx: RequestContext) {
    await ctx.render('home', { n: 'P' }, { layout: false })
  }
  @Get('/shared')
  async shared(ctx: RequestContext) {
    ctx.set('rid', 'r1')
    await ctx.render('home', { n: 'S' })
  }
  @Get('/unawaited')
  unawaited(ctx: RequestContext) {
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    ctx.render('broken', { x: cyclic })
  }
  @Get('/legacy')
  async legacy(ctx: RequestContext) {
    await ctx.render('legacy', { n: 'E' })
  }
}

const routes = { path: '/', prefix: false, version: false, controller: PagesController } as const

const RUNTIMES = [
  { name: 'express', make: () => expressRuntime() },
  { name: 'fastify', make: () => fastifyRuntime() },
  { name: 'h3', make: () => h3Runtime() },
] as const

async function app(make: () => unknown, views: Views, extra: { adapters?: unknown[] } = {}) {
  Container.reset()
  const a = new Application({
    runtime: make() as never,
    modules: [
      class {
        routes() {
          return routes
        }
      } as never,
    ],
    adapters: [KickView({ views }), ...((extra.adapters ?? []) as never[])],
    onNotFound: async (req: any, res: any) => {
      const html = await views.render('errors/404', { path: req.url })
      res.status(404).type('text/html; charset=utf-8').send(html)
    },
  })
  await a.setup()
  return request(a.handle.bind(a))
}

for (const rt of RUNTIMES)
  describe(`KickView — ${rt.name}`, () => {
    let views: Views
    beforeEach(() => {
      views = createViews({
        viewsDir: viewsDir(FILES),
        layout: 'layouts/main',
        share: (ctx) => ({ id: (ctx as RequestContext | undefined)?.get?.('rid') }),
        warn: () => {},
      })
    })

    it('renders a .kick page', async () => {
      const res = await (await app(rt.make, views)).get('/home').expect(200)
      expect(res.headers['content-type']).toBe('text/html; charset=utf-8')
      expect(res.text).toBe('<main><h1>Hi Ada</h1></main>')
    })

    it('status and headers', async () => {
      const res = await (await app(rt.make, views)).get('/created').expect(201)
      expect(res.headers['x-a']).toBe('1')
    })

    it('layout false', async () => {
      expect((await (await app(rt.make, views)).get('/partial')).text).toBe('<h1>Hi P</h1>')
    })

    it('share sees the request', async () => {
      expect((await (await app(rt.make, views)).get('/shared')).text).toBe(
        '<main><h1>Hi S</h1>r1</main>',
      )
    })

    it('not awaited still reports', async () => {
      const prev = process.env.NODE_ENV
      process.env.NODE_ENV = 'production'
      try {
        const res = await (await app(rt.make, views)).get('/unawaited').expect(500)
        expect(res.text).not.toContain('.kick')
        expect(res.text).not.toMatch(/:\d+:\d+/)
      } finally {
        process.env.NODE_ENV = prev
      }
    })

    it('HEAD', async () => {
      const res = await (await app(rt.make, views)).head('/home').expect(200)
      expect(res.text ?? '').toBe('')
    })

    it('.kick error pages', async () => {
      const res = await (await app(rt.make, views)).get('/nowhere').expect(404)
      expect(res.text).toBe('<main><h1>Not here /nowhere</h1></main>')
    })
  })

describe('KickView — web entry', () => {
  it('renders through createWebApp', async () => {
    Container.reset()
    const views = createViews({ viewsDir: viewsDir(FILES), warn: () => {} })
    const web = createWebApp({
      h3: h3v2,
      modules: [
        defineModule({ name: 'Pages', build: () => ({ routes: () => routes }) })() as never,
      ],
      middlewares: [viewsMiddleware(views) as never],
    })
    const res = await web.fetch(new Request('http://edge/home'))
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('<h1>Hi Ada</h1>')
  })
})

describe('KickView — mixing with ViewAdapter (express)', () => {
  it('renders .ejs through ViewAdapter and .kick through KickView', async () => {
    const dir = viewsDir({ ...FILES, 'legacy.ejs': '<p>ejs <%= n %></p>' })
    const views = createViews({ viewsDir: dir, warn: () => {} })
    const agent = await app(() => expressRuntime(), views, {
      adapters: [ViewAdapter({ engine: ejs, ext: 'ejs', viewsDir: dir })],
    })
    expect((await agent.get('/legacy')).text).toBe('<p>ejs E</p>')
    expect((await agent.get('/home')).text).toBe('<h1>Hi Ada</h1>')
  })
})
