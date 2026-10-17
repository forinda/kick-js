import 'reflect-metadata'
import request from 'supertest'
import { beforeEach, describe, expect, it } from 'vitest'
import { fastifyRuntime } from '../src/http/runtimes/fastify'
import { h3Runtime } from '../src/http/runtimes/h3'
import {
  Application,
  Container,
  Controller,
  FileUpload,
  Post,
  expressRuntime,
  type RequestContext,
} from '../src/index'

const RUNTIMES = [
  ['express', () => expressRuntime()],
  ['fastify', () => fastifyRuntime()],
  ['h3', () => h3Runtime()],
] as const

for (const [name, runtime] of RUNTIMES)
  describe(`upload names — ${name}`, () => {
    beforeEach(() => Container.reset())

    async function boot() {
      @Controller()
      class C {
        @Post('/one')
        @FileUpload({ mode: 'single', fieldName: 'file' })
        one(ctx: RequestContext) {
          ctx.json({ originalname: ctx.file?.originalname, filename: ctx.file?.filename })
        }
        @Post('/many')
        @FileUpload({ mode: 'array', fieldName: 'files', maxCount: 3 })
        many(ctx: RequestContext) {
          ctx.json(ctx.files?.map((f) => ({ originalname: f.originalname, filename: f.filename })))
        }
        @Post('/renamed')
        @FileUpload({
          mode: 'single',
          fieldName: 'file',
          rename: (f) => `avatar-${f.fieldname}-${f.size}.bin`,
        })
        renamed(ctx: RequestContext) {
          ctx.json({ filename: ctx.file?.filename })
        }
        @Post('/unsafe')
        @FileUpload({ mode: 'single', fieldName: 'file', rename: () => '../escape' })
        unsafe(ctx: RequestContext) {
          ctx.json({ filename: ctx.file?.filename })
        }
      }
      const app = new Application({
        runtime: runtime(),
        modules: [{ routes: () => ({ path: '/u', controller: C }) } as never],
      })
      await app.setup()
      return request(app.handle.bind(app))
    }

    it('keeps a non-ASCII client name intact', async () => {
      const http = await boot()
      const res = await http.post('/api/v1/u/one').attach('file', Buffer.from('hi'), '中文 🙂.png')
      expect(res.body.originalname).toBe('中文 🙂.png')
    })

    const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/

    it('normalizes the client name: NFC, no directory part, no control characters', async () => {
      const http = await boot()
      const nfd = await http
        .post('/api/v1/u/one')
        .attach('file', Buffer.from('x'), 'cafe\u0301.png')
      expect(nfd.body.originalname).toBe('caf\u00e9.png')
      const path = await http
        .post('/api/v1/u/one')
        .attach('file', Buffer.from('x'), 'C:\\fakepath\\photo.png')
      expect(path.body.originalname).toBe('photo.png')
    })

    it('gives every file a server-side name: a UUID plus a plain extension', async () => {
      const http = await boot()
      const png = await http.post('/api/v1/u/one').attach('file', Buffer.from('x'), '中文 🙂.PNG')
      expect(png.body.filename).toMatch(new RegExp(`${UUID.source}\\.png$`))
      const odd = await http.post('/api/v1/u/one').attach('file', Buffer.from('x'), 'notes.t x t')
      expect(odd.body.filename).toMatch(new RegExp(`${UUID.source}$`))
      // An extension that doesn't name the declared type is dropped, not kept.
      const evil = await http.post('/api/v1/u/one').attach('file', Buffer.from('<script>'), {
        filename: 'evil.html',
        contentType: 'image/png',
      })
      expect(evil.body.filename).toMatch(new RegExp(`${UUID.source}$`))
    })

    it('names each file in an array upload', async () => {
      const http = await boot()
      const res = await http
        .post('/api/v1/u/many')
        .attach('files', Buffer.from('a'), '日本.jpg')
        .attach('files', Buffer.from('b'), '🙂.gif')
      expect(res.body.map((f: { originalname: string }) => f.originalname)).toEqual([
        '日本.jpg',
        '🙂.gif',
      ])
      const [a, b] = res.body.map((f: { filename: string }) => f.filename)
      expect(a).toMatch(/\.jpg$/)
      expect(b).toMatch(/\.gif$/)
      expect(a).not.toBe(b)
    })

    it('uses rename, and refuses a name that is not safe', async () => {
      const http = await boot()
      const res = await http.post('/api/v1/u/renamed').attach('file', Buffer.from('hi'), 'x.png')
      expect(res.body.filename).toBe('avatar-file-2.bin')
      const unsafe = await http.post('/api/v1/u/unsafe').attach('file', Buffer.from('hi'), 'x.png')
      expect(unsafe.status).toBe(500)
    })
  })
