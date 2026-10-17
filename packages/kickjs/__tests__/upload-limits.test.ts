/**
 * Upload routes stop reading at their limits on every engine: a file past
 * maxSize, or more files than the route takes, is a 413 — and the body is not
 * buffered past the route's budget first.
 */
import 'reflect-metadata'
import request from 'supertest'
import { beforeEach, describe, expect, it } from 'vitest'
import { fastifyRuntime } from '../src/http/runtimes/fastify'
import { h3Runtime } from '../src/http/runtimes/h3'
import { uploadLimits } from '../src/http/middleware/upload-config'
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

describe('uploadLimits', () => {
  it("budgets a request from the route's config", () => {
    expect(uploadLimits({ mode: 'single', maxSize: 1000 })).toEqual({
      fileSize: 1000,
      files: 1,
      total: 1000 + 1024 * 1024,
    })
    expect(uploadLimits({ mode: 'array', maxSize: 1000, maxCount: 3 }).files).toBe(3)
    expect(uploadLimits({ mode: 'array' }).files).toBe(10)
    expect(uploadLimits({ mode: 'none' }).files).toBe(0)
  })
})

for (const [name, runtime] of RUNTIMES)
  describe(`upload limits — ${name}`, () => {
    beforeEach(() => Container.reset())

    async function boot() {
      @Controller()
      class C {
        @Post('/one')
        @FileUpload({ mode: 'single', fieldName: 'file', maxSize: 1024 })
        one(ctx: RequestContext) {
          ctx.json({ size: ctx.file?.size })
        }
        @Post('/many')
        @FileUpload({ mode: 'array', fieldName: 'files', maxSize: 1024, maxCount: 2 })
        many(ctx: RequestContext) {
          ctx.json({ count: ctx.files?.length })
        }
      }
      const app = new Application({
        runtime: runtime(),
        modules: [{ routes: () => ({ path: '/u', controller: C }) } as never],
      })
      await app.setup()
      return request(app.handle.bind(app))
    }

    it('accepts uploads within the limits', async () => {
      const http = await boot()
      const one = await http.post('/api/v1/u/one').attach('file', Buffer.alloc(1000), 'a.bin')
      expect(one.status).toBe(200)
      expect(one.body).toEqual({ size: 1000 })
      const many = await http
        .post('/api/v1/u/many')
        .attach('files', Buffer.alloc(10), 'a.bin')
        .attach('files', Buffer.alloc(10), 'b.bin')
      expect(many.body).toEqual({ count: 2 })
    })

    it('refuses a file past maxSize with 413', async () => {
      const http = await boot()
      const res = await http.post('/api/v1/u/one').attach('file', Buffer.alloc(4096), 'big.bin')
      expect(res.status).toBe(413)
    })

    it("refuses a body far past the route's budget with 413", async () => {
      const http = await boot()
      const res = await http
        .post('/api/v1/u/one')
        .attach('file', Buffer.alloc(3 * 1024 * 1024), 'huge.bin')
      expect(res.status).toBe(413)
    })

    it('refuses more files than the route takes with 413', async () => {
      const http = await boot()
      const res = await http
        .post('/api/v1/u/many')
        .attach('files', Buffer.alloc(10), 'a.bin')
        .attach('files', Buffer.alloc(10), 'b.bin')
        .attach('files', Buffer.alloc(10), 'c.bin')
      expect(res.status).toBe(413)
      expect(res.body.detail).toMatch(/Too many files: at most 2/)
    })
  })
