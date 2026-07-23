import 'reflect-metadata'
import { describe, it, expect, beforeEach, vi } from 'vitest'

// This is a heavy integration suite: 13 cases run against three real HTTP
// engines (express + fastify + h3) over supertest. Fastify in particular pays a
// one-time cold cost on the first case — `require('fastify')` + `@fastify/middie`
// + avvio's async `ready()` plugin-graph boot — which, when the full package
// suite (50+ files) imports in parallel and saturates the CPU, can blow past
// vitest's default 5s budget and flake the first test. The work is the same in
// production (boots once at startup); only the test-time contention makes it
// slow. Give the whole file generous head-room so cold-start jitter never trips
// a timeout. File-scoped — other suites keep the 5s default.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 })
import request from 'supertest'
import { z } from 'zod'
import {
  Application,
  Container,
  Controller,
  FileUpload,
  Get,
  Post,
  RequestContext,
  defineContextDecorator,
  expressRuntime,
  type HttpRuntime,
} from '../src/index'
import { fastifyRuntime } from '../src/http/runtimes/fastify'
import { h3Runtime } from '../src/http/runtimes/h3'

// One fixture app, run under both runtimes — the conformance harness. Proves the
// HttpRuntime contract holds for Fastify: native routing, the RuntimeResponse
// driver (ctx.json / ctx.html), and connect middleware via @fastify/middie.
const RUNTIMES: Array<{ name: string; make: () => HttpRuntime }> = [
  { name: 'express', make: () => expressRuntime() },
  { name: 'fastify', make: () => fastifyRuntime() },
  { name: 'h3', make: () => h3Runtime() },
]

beforeEach(() => {
  Container.reset()
})

for (const rt of RUNTIMES) {
  describe(`runtime conformance — ${rt.name}`, () => {
    it('routes a GET and serves JSON through the response driver', async () => {
      @Controller()
      class PingController {
        @Get('/ping/:name')
        ping(ctx: RequestContext) {
          ctx.json({ pong: ctx.params.name })
        }
      }

      const app = new Application({
        // runtime option is HttpRuntime<Express> until it widens with the driver
        // layer; the fastify runtime is sound here (cast at the call site).
        runtime: rt.make(),
        apiPrefix: '/api',
        defaultVersion: 1,
        modules: [{ routes: () => ({ path: '/p', controller: PingController }) } as never],
      })
      await app.setup()

      const res = await request(app.handle.bind(app)).get('/api/v1/p/ping/ada').expect(200)
      expect(res.body).toEqual({ pong: 'ada' })
    })

    it('serves HTML through the response driver', async () => {
      @Controller()
      class HtmlController {
        @Get('/page')
        page(ctx: RequestContext) {
          ctx.html('<h1>hi</h1>')
        }
      }
      const app = new Application({
        runtime: rt.make(),
        modules: [{ routes: () => ({ path: '/h', controller: HtmlController }) } as never],
      })
      await app.setup()

      const res = await request(app.handle.bind(app)).get('/api/v1/h/page').expect(200)
      expect(res.text).toContain('<h1>hi</h1>')
      expect(res.headers['content-type']).toMatch(/html/)
    })

    it('runs a global connect middleware', async () => {
      @Controller()
      class C {
        @Get('/m')
        m(ctx: RequestContext) {
          ctx.json({ ok: true })
        }
      }
      const app = new Application({
        runtime: rt.make(),
        middlewares: [
          ((
            _req: unknown,
            res: { setHeader: (n: string, v: string) => void },
            next: () => void,
          ) => {
            res.setHeader('x-conformance', rt.name)
            next()
          }) as never,
        ],
        modules: [{ routes: () => ({ path: '/mw', controller: C }) } as never],
      })
      await app.setup()

      const res = await request(app.handle.bind(app)).get('/api/v1/mw/m').expect(200)
      expect(res.headers['x-conformance']).toBe(rt.name)
    })

    it('runs a context contributor and exposes it via ctx.get (ALS frame)', async () => {
      const LoadWho = defineContextDecorator({ key: 'who', resolve: () => 'ada' })

      @Controller()
      class C {
        @LoadWho
        @Get('/who')
        who(ctx: RequestContext) {
          ctx.json({ who: ctx.get('who') })
        }
      }
      const app = new Application({
        runtime: rt.make(),
        apiPrefix: '/api',
        defaultVersion: 1,
        modules: [{ routes: () => ({ path: '/c', controller: C }) } as never],
      })
      await app.setup()

      const res = await request(app.handle.bind(app)).get('/api/v1/c/who').expect(200)
      expect(res.body).toEqual({ who: 'ada' })
    })

    it('maps a thrown error to a 500 through the error handler', async () => {
      @Controller()
      class C {
        @Get('/boom')
        boom() {
          throw new Error('kaboom')
        }
      }
      const app = new Application({
        runtime: rt.make(),
        modules: [{ routes: () => ({ path: '/e', controller: C }) } as never],
      })
      await app.setup()

      const res = await request(app.handle.bind(app)).get('/api/v1/e/boom').expect(500)
      // The cross-runtime invariant is the status + the opaque client-facing
      // message. Outside production the body also carries `error`, `stack`,
      // and `requestId` — asserted in error-diagnostics.test.ts rather than
      // pinned here, so this stays a conformance check and not a snapshot of
      // the dev payload.
      expect(res.body).toMatchObject({ message: 'Internal Server Error' })
      expect(res.body.requestId).toBeTruthy()
    })

    it('returns 404 for an unmatched route', async () => {
      @Controller()
      class C {
        @Get('/here')
        here(ctx: RequestContext) {
          ctx.json({ ok: true })
        }
      }
      const app = new Application({
        runtime: rt.make(),
        modules: [{ routes: () => ({ path: '/nf', controller: C }) } as never],
      })
      await app.setup()

      await request(app.handle.bind(app)).get('/api/v1/nf/nope').expect(404)
    })

    it('streams Server-Sent Events through the response driver', async () => {
      @Controller()
      class C {
        @Get('/events')
        events(ctx: RequestContext) {
          const sse = ctx.sse()
          sse.send({ tick: 1 }, 'tick')
          sse.close()
        }
      }
      const app = new Application({
        runtime: rt.make(),
        modules: [{ routes: () => ({ path: '/s', controller: C }) } as never],
      })
      await app.setup()

      const res = await request(app.handle.bind(app)).get('/api/v1/s/events').expect(200)
      expect(res.headers['content-type']).toMatch(/text\/event-stream/)
      expect(res.text).toContain('event: tick')
      expect(res.text).toContain('"tick":1')
    })

    it('validates the request body and rejects invalid input', async () => {
      const schema = z.object({ title: z.string().min(1) })

      @Controller()
      class C {
        @Post('/', { body: schema })
        create(ctx: RequestContext) {
          ctx.created({ title: (ctx.body as { title: string }).title })
        }
      }
      const app = new Application({
        runtime: rt.make(),
        modules: [{ routes: () => ({ path: '/v', controller: C }) } as never],
      })
      await app.setup()
      const handler = app.handle.bind(app)

      // Valid body → 201 with parsed data.
      const ok = await request(handler).post('/api/v1/v').send({ title: 'hi' }).expect(201)
      expect(ok.body).toEqual({ title: 'hi' })

      // Invalid body → rejected by validation (not 2xx).
      const bad = await request(handler).post('/api/v1/v').send({ title: '' })
      expect(bad.status).toBeGreaterThanOrEqual(400)
    })

    it('accepts a single file upload and exposes it on ctx.file', async () => {
      @Controller()
      class C {
        @Post('/avatar')
        @FileUpload({ mode: 'single', fieldName: 'avatar' })
        upload(ctx: RequestContext) {
          const f = ctx.file
          ctx.created({
            name: f?.originalname,
            mimetype: f?.mimetype,
            size: f?.size,
            content: f?.buffer.toString('utf-8'),
            // a non-file field rides along on ctx.body
            note: (ctx.body as { note?: string }).note,
          })
        }
      }
      const app = new Application({
        runtime: rt.make(),
        modules: [{ routes: () => ({ path: '/u', controller: C }) } as never],
      })
      await app.setup()

      const res = await request(app.handle.bind(app))
        .post('/api/v1/u/avatar')
        .field('note', 'hello')
        .attach('avatar', Buffer.from('PNGDATA'), {
          filename: 'pic.png',
          contentType: 'image/png',
        })
        .expect(201)
      expect(res.body).toEqual({
        name: 'pic.png',
        mimetype: 'image/png',
        size: 7,
        content: 'PNGDATA',
        note: 'hello',
      })
    })

    it('accepts an array upload and exposes ctx.files', async () => {
      @Controller()
      class C {
        @Post('/docs')
        @FileUpload({ mode: 'array', fieldName: 'docs', maxCount: 3 })
        upload(ctx: RequestContext) {
          ctx.created({ names: (ctx.files ?? []).map((f) => f.originalname) })
        }
      }
      const app = new Application({
        runtime: rt.make(),
        modules: [{ routes: () => ({ path: '/u', controller: C }) } as never],
      })
      await app.setup()

      const res = await request(app.handle.bind(app))
        .post('/api/v1/u/docs')
        .attach('docs', Buffer.from('a'), { filename: 'a.txt', contentType: 'text/plain' })
        .attach('docs', Buffer.from('b'), { filename: 'b.txt', contentType: 'text/plain' })
        .expect(201)
      expect(res.body).toEqual({ names: ['a.txt', 'b.txt'] })
    })

    it('serves a controller root route with and without a trailing slash', async () => {
      // Regression: a controller `@Get('/')` mounts at the prefix itself. Fastify's
      // strict router 404s `${prefix}/` (trailing slash) unless ignoreTrailingSlash
      // is on — Express and h3 are lenient. Both forms must resolve.
      @Controller()
      class Root {
        @Get('/')
        root(ctx: RequestContext) {
          ctx.json({ ok: true })
        }
      }
      const app = new Application({
        runtime: rt.make(),
        modules: [{ routes: () => ({ path: '/root', controller: Root }) } as never],
      })
      await app.setup()
      const handler = app.handle.bind(app)

      const noSlash = await request(handler).get('/api/v1/root').expect(200)
      expect(noSlash.body).toEqual({ ok: true })
      const withSlash = await request(handler).get('/api/v1/root/').expect(200)
      expect(withSlash.body).toEqual({ ok: true })
    })

    it('reaches routes from multiple mount sources, and still 404s the rest', async () => {
      // Regression: h3's router is terminal (throws on no match), so two route
      // sources mounted as separate routers would let the first shadow the
      // second. Both controllers must be reachable; an unmatched path is a clean
      // 404, not a surfaced error.
      @Controller()
      class A {
        @Get('/a')
        a(ctx: RequestContext) {
          ctx.json({ from: 'a' })
        }
      }
      @Controller()
      class B {
        @Get('/b')
        b(ctx: RequestContext) {
          ctx.json({ from: 'b' })
        }
      }
      const app = new Application({
        runtime: rt.make(),
        modules: [
          { routes: () => ({ path: '/one', controller: A }) } as never,
          { routes: () => ({ path: '/two', controller: B }) } as never,
        ],
      })
      await app.setup()
      const handler = app.handle.bind(app)

      const ra = await request(handler).get('/api/v1/one/a').expect(200)
      expect(ra.body).toEqual({ from: 'a' })
      const rb = await request(handler).get('/api/v1/two/b').expect(200)
      expect(rb.body).toEqual({ from: 'b' })
      await request(handler).get('/api/v1/one/nope').expect(404)
    })

    it('rejects a file whose type is not allowed', async () => {
      @Controller()
      class C {
        @Post('/img')
        @FileUpload({ mode: 'single', fieldName: 'img', allowedTypes: ['png'] })
        upload(ctx: RequestContext) {
          ctx.created({ name: ctx.file?.originalname })
        }
      }
      const app = new Application({
        runtime: rt.make(),
        modules: [{ routes: () => ({ path: '/u', controller: C }) } as never],
      })
      await app.setup()

      const res = await request(app.handle.bind(app))
        .post('/api/v1/u/img')
        .attach('img', Buffer.from('%PDF'), { filename: 'doc.pdf', contentType: 'application/pdf' })
      expect(res.status).toBeGreaterThanOrEqual(400)
    })
  })
}
