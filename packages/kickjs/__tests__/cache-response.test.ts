import 'reflect-metadata'
import request from 'supertest'
import { beforeEach, describe, expect, it } from 'vitest'
import { fastifyRuntime } from '../src/http/runtimes/fastify'
import { h3Runtime } from '../src/http/runtimes/h3'
import {
  Application,
  CacheEvict,
  CacheResponse,
  Container,
  Controller,
  Get,
  MemoryCacheProvider,
  expressRuntime,
  setCacheProvider,
  settleBackgroundWork,
  type RequestContext,
} from '../src/index'

const RUNTIMES = [
  ['express', () => expressRuntime()],
  ['fastify', () => fastifyRuntime()],
  ['h3', () => h3Runtime()],
] as const

for (const [name, runtime] of RUNTIMES)
  describe(`@CacheResponse — ${name}`, () => {
    let loads: number
    let version: number

    beforeEach(() => {
      Container.reset()
      setCacheProvider(new MemoryCacheProvider())
      loads = 0
      version = 1
    })

    async function boot(controller: new () => unknown, middlewares: unknown[] = []) {
      const app = new Application({
        runtime: runtime(),
        middlewares: middlewares as never,
        modules: [{ routes: () => ({ path: '/c', controller }) } as never],
      })
      await app.setup()
      const http = request(app.handle.bind(app))
      // supertest listens on a new port per request; the Host header is part of the key.
      return { get: (path: string) => http.get(path).set('Host', 'test.local') }
    }

    it('serves a stored response, with an ETag a matching request gets 304 for', async () => {
      @Controller()
      class C {
        @CacheResponse({ maxAge: 60 })
        @Get('/list')
        list(ctx: RequestContext) {
          loads++
          ctx.json({ version })
        }
      }
      const http = await boot(C)

      const first = await http.get('/api/v1/c/list').expect(200)
      version = 2
      const second = await http.get('/api/v1/c/list').expect(200)
      expect(second.body).toEqual({ version: 1 })
      expect(second.headers['content-type']).toMatch(/application\/json/)
      expect(second.headers.etag).toBe(first.headers.etag)
      expect(first.headers.etag).toMatch(/^W\/"/)

      const fresh = await http
        .get('/api/v1/c/list')
        .set('If-None-Match', first.headers.etag)
        .expect(304)
      expect(fresh.text).toBe('')
      expect(loads).toBe(1)
    })

    it('caches a returned value and html, keyed by the query string', async () => {
      @Controller()
      class C {
        @CacheResponse({ maxAge: 60 })
        @Get('/item')
        item(ctx: RequestContext) {
          loads++
          return { q: ctx.query.q }
        }
        @CacheResponse({ maxAge: 60 })
        @Get('/page')
        page(ctx: RequestContext) {
          loads++
          ctx.html('<p>hi</p>')
        }
      }
      const http = await boot(C)

      expect((await http.get('/api/v1/c/item?q=a').expect(200)).body).toEqual({ q: 'a' })
      expect((await http.get('/api/v1/c/item?q=a').expect(200)).body).toEqual({ q: 'a' })
      expect((await http.get('/api/v1/c/item?q=b').expect(200)).body).toEqual({ q: 'b' })
      const page = await http.get('/api/v1/c/page').expect(200)
      await http.get('/api/v1/c/page').expect(200)
      expect(page.headers['content-type']).toMatch(/text\/html/)
      expect(page.text).toBe('<p>hi</p>')
      expect(loads).toBe(3)
    })

    it('skips requests carrying Authorization or a cookie, unless the route varies on it', async () => {
      @Controller()
      class C {
        @CacheResponse({ maxAge: 60 })
        @Get('/shared')
        shared(ctx: RequestContext) {
          loads++
          ctx.json({ who: ctx.headers.authorization ?? 'anon' })
        }
        @CacheResponse({ maxAge: 60, varies: ['authorization'] })
        @Get('/mine')
        mine(ctx: RequestContext) {
          loads++
          ctx.json({ who: ctx.headers.authorization })
        }
      }
      const http = await boot(C)

      await http.get('/api/v1/c/shared').set('Authorization', 'Bearer ann').expect(200)
      await http.get('/api/v1/c/shared').set('Cookie', 'sid=1').expect(200)
      const anon = await http.get('/api/v1/c/shared').expect(200)
      expect(anon.body).toEqual({ who: 'anon' })
      expect(loads).toBe(3)

      loads = 0
      const ann = await http.get('/api/v1/c/mine').set('Authorization', 'Bearer ann').expect(200)
      const ben = await http.get('/api/v1/c/mine').set('Authorization', 'Bearer ben').expect(200)
      await http.get('/api/v1/c/mine').set('Authorization', 'Bearer ann').expect(200)
      expect(ann.body).toEqual({ who: 'Bearer ann' })
      expect(ben.body).toEqual({ who: 'Bearer ben' })
      expect(loads).toBe(2)
    })

    it('stores only a 200 that sets no cookie', async () => {
      @Controller()
      class C {
        @CacheResponse({ maxAge: 60 })
        @Get('/missing')
        missing(ctx: RequestContext) {
          loads++
          ctx.json({ error: 'nope' }, 404)
        }
        @CacheResponse({ maxAge: 60 })
        @Get('/login')
        login(ctx: RequestContext) {
          loads++
          ctx.setHeader('Set-Cookie', 'sid=1')
          ctx.json({ ok: true })
        }
      }
      const http = await boot(C)

      expect((await http.get('/api/v1/c/missing').expect(404)).body).toEqual({ error: 'nope' })
      await http.get('/api/v1/c/missing').expect(404)
      const login = await http.get('/api/v1/c/login').expect(200)
      expect(login.headers['set-cookie']).toEqual(['sid=1'])
      await http.get('/api/v1/c/login').expect(200)
      expect(loads).toBe(4)
    })

    it('past maxAge, serves the stale copy and rebuilds it in the background', async () => {
      @Controller()
      class C {
        @CacheResponse({ maxAge: 0, swr: 60 })
        @Get('/feed')
        feed(ctx: RequestContext) {
          loads++
          ctx.json({ version })
        }
      }
      const http = await boot(C)

      await http.get('/api/v1/c/feed').expect(200)
      version = 2
      const stale = await http.get('/api/v1/c/feed').expect(200)
      expect(stale.body).toEqual({ version: 1 })
      await settleBackgroundWork()
      expect(loads).toBe(2)
      expect((await http.get('/api/v1/c/feed').expect(200)).body).toEqual({ version: 2 })
    })

    it('builds once for concurrent misses', async () => {
      @Controller()
      class C {
        @CacheResponse({ maxAge: 60 })
        @Get('/slow')
        async slow(ctx: RequestContext) {
          loads++
          await new Promise((r) => setTimeout(r, 30))
          ctx.json({ version })
        }
      }
      const http = await boot(C)

      const responses = await Promise.all([1, 2, 3].map(() => http.get('/api/v1/c/slow')))
      expect(responses.map((r) => r.status)).toEqual([200, 200, 200])
      expect(responses.map((r) => r.body)).toEqual([{ version: 1 }, { version: 1 }, { version: 1 }])
      expect(loads).toBe(1)
    })

    it('a key function decides the key, even for a signed-in request; null skips the cache', async () => {
      @Controller()
      class C {
        @CacheResponse({
          maxAge: 60,
          key: (ctx) => (ctx.query.fresh ? null : `tenant:${ctx.headers['x-tenant']}`),
        })
        @Get('/stats')
        stats(ctx: RequestContext) {
          loads++
          ctx.json({ tenant: ctx.headers['x-tenant'] })
        }
      }
      const http = await boot(C)

      const auth = { Authorization: 'Bearer ann', 'X-Tenant': 'acme' }
      await http.get('/api/v1/c/stats').set(auth).expect(200)
      const again = await http.get('/api/v1/c/stats').set({ ...auth, Authorization: 'Bearer ben' })
      expect(again.body).toEqual({ tenant: 'acme' })
      await http.get('/api/v1/c/stats').set({ 'X-Tenant': 'globex' }).expect(200)
      expect(loads).toBe(2)
      await http.get('/api/v1/c/stats?fresh=1').set(auth).expect(200)
      expect(loads).toBe(3)
    })

    it('keys on the host, skips an API key, and @CacheEvict clears a named prefix', async () => {
      @Controller()
      class C {
        @CacheResponse({ maxAge: 60, key: 'products' })
        @Get('/products')
        list(ctx: RequestContext) {
          loads++
          ctx.json({ host: ctx.headers.host, version })
        }
        @CacheEvict('products')
        @Get('/products/touch')
        touch(ctx: RequestContext) {
          ctx.json({ ok: true })
        }
      }
      const http = await boot(C)

      await http.get('/api/v1/c/products').set('Host', 'a.example').expect(200)
      await http.get('/api/v1/c/products').set('Host', 'a.example').expect(200)
      const b = await http.get('/api/v1/c/products').set('Host', 'b.example').expect(200)
      expect(b.body.host).toBe('b.example')
      expect(loads).toBe(2)

      await http
        .get('/api/v1/c/products')
        .set('Host', 'a.example')
        .set('X-Api-Key', 'k')
        .expect(200)
      expect(loads).toBe(3)

      // The port is part of the host the handler sees; a malformed host is never cached.
      await http.get('/api/v1/c/products').set('Host', 'a.example:8080').expect(200)
      await http.get('/api/v1/c/products').set('Host', 'a.example/evil').expect(200)
      await http.get('/api/v1/c/products').set('Host', 'a.example/evil').expect(200)
      expect(loads).toBe(6)

      version = 2
      await http.get('/api/v1/c/products/touch').expect(200)
      const after = await http.get('/api/v1/c/products').set('Host', 'a.example').expect(200)
      expect(after.body.version).toBe(2)
    })

    it('skips a request whose ctx.user is set, unless the route varies on a caller header', async () => {
      @Controller()
      class C {
        @CacheResponse({ maxAge: 60 })
        @Get('/me')
        me(ctx: RequestContext) {
          loads++
          ctx.json({ id: (ctx.user as { id?: number } | undefined)?.id })
        }
      }
      const signIn = (req: { user?: unknown }, _res: unknown, next: () => void) => {
        req.user = { id: 7 }
        next()
      }
      const http = await boot(C, [signIn])
      await http.get('/api/v1/c/me').expect(200)
      expect((await http.get('/api/v1/c/me').expect(200)).body).toEqual({ id: 7 })
      expect(loads).toBe(2)
    })

    it("never hands one request's unshareable response to another that waited for it", async () => {
      @Controller()
      class C {
        @CacheResponse({ maxAge: 60 })
        @Get('/session')
        async session(ctx: RequestContext) {
          const id = ++loads
          await new Promise((r) => setTimeout(r, 30))
          ctx.setHeader('Set-Cookie', `sid=${id}`)
          ctx.json({ id })
        }
      }
      const http = await boot(C)

      const responses = await Promise.all([1, 2, 3].map(() => http.get('/api/v1/c/session')))
      const cookies = responses.map((r) => String(r.headers['set-cookie']))
      expect(new Set(cookies).size).toBe(3)
      expect(responses.map((r) => r.body.id).toSorted()).toEqual([1, 2, 3])
    })

    it('never stores a response the handler touched through ctx.res', async () => {
      @Controller()
      class C {
        @CacheResponse({ maxAge: 60 })
        @Get('/native')
        native(ctx: RequestContext) {
          loads++
          const res = ctx.res as unknown as Record<string, (...a: unknown[]) => unknown>
          ;(res.setHeader ?? res.header).call(res, 'Set-Cookie', 'sid=native')
          ctx.json({ loads })
        }
      }
      const http = await boot(C)

      const first = await http.get('/api/v1/c/native').expect(200)
      expect(String(first.headers['set-cookie'])).toContain('sid=native')
      await http.get('/api/v1/c/native').expect(200)
      expect(loads).toBe(2)
    })

    it('maxAge 0 without swr stores nothing', async () => {
      @Controller()
      class C {
        @CacheResponse({ maxAge: 0 })
        @Get('/now')
        now(ctx: RequestContext) {
          loads++
          ctx.json({ loads })
        }
      }
      const http = await boot(C)
      await http.get('/api/v1/c/now').expect(200)
      await http.get('/api/v1/c/now').expect(200)
      expect(loads).toBe(2)
    })
  })
