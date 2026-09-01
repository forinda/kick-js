/**
 * `@FileUpload` and route validation, on every runtime.
 *
 * These two diverge the most by construction. Uploads use a different backend
 * per engine — multer under Express, `@fastify/multipart` under Fastify,
 * `readMultipartFormData` under h3 — so `ctx.file` / `ctx.files` are assembled
 * three separate ways and only end-to-end tests compare the results. Validation
 * runs before the handler on every engine but reads a body each one parsed
 * differently.
 *
 * @module @forinda/kickjs-testing/__tests__/upload-validate-matrix.test
 */

import { describe, expect, it } from 'vitest'
import request from 'supertest'
import { z } from 'zod'
import { Controller, FileUpload, Post, expressRuntime, type RequestContext } from '@forinda/kickjs'

// Source paths: this package's vitest alias maps the bare specifier at src/index.ts.
import { fastifyRuntime } from '../../kickjs/src/http/runtimes/fastify'
import { h3Runtime } from '../../kickjs/src/http/runtimes/h3'
import { createTestApp, createTestModule } from '../src/index'

const createBody = z.object({ name: z.string().min(2), age: z.coerce.number().int().min(0) })

@Controller()
class UploadController {
  @Post('/one')
  @FileUpload({ mode: 'single', fieldName: 'doc' })
  one(ctx: RequestContext) {
    const file = ctx.file as { originalname?: string; size?: number; mimetype?: string } | undefined
    return {
      name: file?.originalname ?? null,
      size: file?.size ?? null,
      type: file?.mimetype ?? null,
      // Text fields sent alongside the file must survive too.
      title: (ctx.body as { title?: string } | undefined)?.title ?? null,
    }
  }

  @Post('/many')
  @FileUpload({ mode: 'array', fieldName: 'docs', maxCount: 3 })
  many(ctx: RequestContext) {
    const files = (ctx.files ?? []) as Array<{ originalname?: string }>
    return { count: files.length, names: files.map((f) => f.originalname ?? null) }
  }

  @Post('/limited')
  @FileUpload({ mode: 'single', fieldName: 'doc', maxSize: 16 })
  limited(ctx: RequestContext) {
    return { name: (ctx.file as { originalname?: string } | undefined)?.originalname ?? null }
  }

  @Post('/images')
  @FileUpload({ mode: 'single', fieldName: 'doc', allowedTypes: ['png'] })
  images(ctx: RequestContext) {
    return { name: (ctx.file as { originalname?: string } | undefined)?.originalname ?? null }
  }

  @Post('/validated', { body: createBody })
  validated(ctx: RequestContext) {
    return { received: ctx.body }
  }
}

const UploadModule = createTestModule({
  register: () => {},
  routes: () => ({ path: '/files', controller: UploadController }),
})

const runtimes = [
  { name: 'express', make: () => expressRuntime() },
  { name: 'fastify', make: () => fastifyRuntime() },
  { name: 'h3', make: () => h3Runtime() },
] as const

describe.each(runtimes)('uploads and validation on $name', ({ make }) => {
  async function agent() {
    const { app } = await createTestApp({
      modules: [UploadModule],
      runtime: make(),
      isolated: true,
    })
    return request(app.handle.bind(app))
  }

  describe('@FileUpload single', () => {
    it('exposes the file with its name, size and type', async () => {
      const res = await (
        await agent()
      )
        .post('/api/v1/files/one')
        .attach('doc', Buffer.from('hello world'), {
          filename: 'note.txt',
          contentType: 'text/plain',
        })

      expect(res.status).toBe(200)
      expect(res.body.name).toBe('note.txt')
      expect(res.body.size).toBe(11)
      expect(res.body.type).toContain('text/plain')
    })

    it('keeps text fields sent alongside the file', async () => {
      // Multipart carries both; an engine that reads only the file loses these.
      const res = await (
        await agent()
      )
        .post('/api/v1/files/one')
        .field('title', 'my upload')
        .attach('doc', Buffer.from('x'), { filename: 'a.txt', contentType: 'text/plain' })

      expect(res.status).toBe(200)
      expect(res.body.title).toBe('my upload')
    })

    it('leaves ctx.file empty when no file is sent', async () => {
      const res = await (await agent()).post('/api/v1/files/one').field('title', 'no file')
      expect(res.status).toBe(200)
      expect(res.body.name).toBeNull()
    })
  })

  describe('@FileUpload array', () => {
    it('collects every file under the field', async () => {
      const res = await (
        await agent()
      )
        .post('/api/v1/files/many')
        .attach('docs', Buffer.from('a'), { filename: 'a.txt', contentType: 'text/plain' })
        .attach('docs', Buffer.from('b'), { filename: 'b.txt', contentType: 'text/plain' })

      expect(res.status).toBe(200)
      expect(res.body.count).toBe(2)
      expect(res.body.names).toEqual(['a.txt', 'b.txt'])
    })
  })

  describe('@FileUpload limits', () => {
    it('rejects a file over maxSize with the same status everywhere', async () => {
      // multer, @fastify/multipart and readMultipartFormData each enforce this
      // differently; the response an adopter sees must not depend on that.
      const res = await (
        await agent()
      )
        .post('/api/v1/files/limited')
        .attach('doc', Buffer.alloc(64, 'x'), { filename: 'big.txt', contentType: 'text/plain' })

      // 413, not 500: an oversized upload is the client's doing. Express used
      // to surface multer's raw `MulterError: File too large` as a server
      // fault, stack included, while the other two answered 413.
      expect(res.status).toBe(413)
      // Express names the FIELD here and the others the filename — multer's
      // LIMIT_FILE_SIZE error carries no filename to report. The status and the
      // limit are what a client acts on, so those are what this pins.
      expect(res.body.detail).toContain('exceeds the 16-byte limit')
    })

    it('accepts a file under maxSize', async () => {
      const res = await (
        await agent()
      )
        .post('/api/v1/files/limited')
        .attach('doc', Buffer.from('small'), { filename: 'ok.txt', contentType: 'text/plain' })
      expect(res.status).toBe(200)
      expect(res.body.name).toBe('ok.txt')
    })

    it('rejects a disallowed file type with the same status everywhere', async () => {
      const res = await (
        await agent()
      )
        .post('/api/v1/files/images')
        .attach('doc', Buffer.from('not-an-image'), {
          filename: 'note.txt',
          contentType: 'text/plain',
        })

      expect(res.status).toBe(415)
      expect(res.body.detail).toBe('File type text/plain is not allowed')
    })
  })

  describe('validation', () => {
    it('accepts a valid body', async () => {
      const res = await (
        await agent()
      )
        .post('/api/v1/files/validated')
        .send({ name: 'kim', age: 30 })
      expect(res.status).toBe(200)
      expect(res.body.received).toMatchObject({ name: 'kim', age: 30 })
    })

    it('rejects an invalid body with 422', async () => {
      const res = await (await agent()).post('/api/v1/files/validated').send({ name: 'k', age: -1 })
      expect(res.status).toBe(422)
    })

    it('applies the schema transform, not just the check', async () => {
      // `z.coerce.number()` means the handler must see a number, not the "30"
      // that arrived. An engine that validates a parsed copy but hands the
      // handler the raw body would pass the check and fail here.
      const res = await (
        await agent()
      )
        .post('/api/v1/files/validated')
        .send({ name: 'kim', age: '30' })
      expect(res.status).toBe(200)
      expect(res.body.received.age).toBe(30)
    })
  })
})
