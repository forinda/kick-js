/**
 * No request input reaches Object.prototype: query strings, urlencoded and JSON
 * bodies, multipart fields — on every engine. Field names like `__proto__` or
 * `constructor[prototype][x]` stay plain data.
 */
import 'reflect-metadata'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { fastifyRuntime } from '../src/http/runtimes/fastify'
import { h3Runtime } from '../src/http/runtimes/h3'
import {
  Application,
  Container,
  Controller,
  FileUpload,
  Get,
  Post,
  expressRuntime,
  type RequestContext,
} from '../src/index'

const RUNTIMES = [
  ['express', () => expressRuntime()],
  ['fastify', () => fastifyRuntime()],
  ['h3', () => h3Runtime()],
] as const

const MARKERS = ['polluted', 'polluted2', 'polluted3']

function prototypeIsClean() {
  const probe = {} as Record<string, unknown>
  return MARKERS.every((m) => probe[m] === undefined && !(m in Object.prototype))
}

afterEach(() => {
  for (const m of MARKERS) delete (Object.prototype as Record<string, unknown>)[m]
})

for (const [name, runtime] of RUNTIMES)
  describe(`prototype pollution — ${name}`, () => {
    beforeEach(() => Container.reset())

    async function boot() {
      @Controller()
      class C {
        @Get('/q')
        query(ctx: RequestContext) {
          ctx.json({ query: ctx.query })
        }
        @Post('/form')
        form(ctx: RequestContext) {
          ctx.json({ body: ctx.body })
        }
        @Post('/upload')
        @FileUpload({ mode: 'single', fieldName: 'file' })
        upload(ctx: RequestContext) {
          ctx.json({ body: ctx.body })
        }
      }
      const app = new Application({
        runtime: runtime(),
        modules: [{ routes: () => ({ path: '/p', controller: C }) } as never],
      })
      await app.setup()
      return request(app.handle.bind(app))
    }

    const payload =
      '__proto__[polluted]=1&constructor[prototype][polluted2]=1&a[__proto__][polluted3]=1'

    it('query string', async () => {
      const http = await boot()
      await http.get(`/api/v1/p/q?${payload}`)
      expect(prototypeIsClean()).toBe(true)
    })

    it('urlencoded body — refused with 400', async () => {
      const http = await boot()
      const res = await http.post('/api/v1/p/form').type('form').send(`__proto__=x&${payload}`)
      expect(res.status).toBe(400)
      expect(prototypeIsClean()).toBe(true)
      await http.post('/api/v1/p/form').type('form').send('name=ok').expect(200)
    })

    it('JSON body — refused with 400', async () => {
      const http = await boot()
      const res = await http
        .post('/api/v1/p/form')
        .set('Content-Type', 'application/json')
        .send('{"__proto__":{"polluted":1},"constructor":{"prototype":{"polluted2":1}}}')
      expect(res.status).toBe(400)
      expect(prototypeIsClean()).toBe(true)
      // A field merely named `constructor` is fine.
      await http
        .post('/api/v1/p/form')
        .send({ constructor: 'x', a: { b: 1 } })
        .expect(200)
    })

    it('multipart fields — refused with 400', async () => {
      const http = await boot()
      const res = await http
        .post('/api/v1/p/upload')
        .field('__proto__[polluted]', '1')
        .field('constructor[prototype][polluted2]', '1')
        .field('a[__proto__][polluted3]', '1')
        .field('__proto__', 'x')
        .attach('file', Buffer.from('hi'), 'a.txt')
      expect(res.status).toBe(400)
      expect(prototypeIsClean()).toBe(true)
    })
  })
