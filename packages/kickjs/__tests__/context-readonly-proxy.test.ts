import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { RequestContext } from '../src/http/context'
import { requestStore } from '../src/http/request-store'

/**
 * `DeepReadonly<T>` on `ctx.body` / `ctx.params` / `ctx.query` was
 * breaking TS narrowing on typed request payloads (discriminated
 * unions in particular). The runtime contract — "request data is
 * not yours to mutate, compute new values and stash via `ctx.set`"
 * — is now enforced by a dev-only Proxy that warns on writes and
 * leaves the underlying value untouched. Production is a pass-through.
 *
 * These tests pin both halves of the contract: warn-on-write in dev,
 * silent passthrough in prod.
 */

interface CtxOverrides {
  body?: unknown
  params?: Record<string, unknown>
  query?: Record<string, unknown>
  headers?: Record<string, unknown>
  file?: unknown
  files?: unknown
}

function withCtx<T>(overrides: CtxOverrides, fn: (ctx: RequestContext) => T): T {
  // `req` / `res` are intentionally loose — RequestContext only reads
  // a handful of properties + EventEmitter wiring for the close signal.
  // Mirrors the helper in `context-signal.test.ts`.
  const req = Object.assign(new EventEmitter(), {
    // Use `'body' in overrides` so explicit `null` / primitive bodies
    // survive — the `??` fallback would silently coerce them to `{}`.
    body: 'body' in overrides ? overrides.body : {},
    params: overrides.params ?? {},
    query: overrides.query ?? {},
    headers: overrides.headers ?? {},
    file: overrides.file,
    files: overrides.files,
  }) as unknown as EventEmitter & Record<string, unknown>
  const res = new EventEmitter() as EventEmitter & Record<string, unknown>
  const next = () => {}
  const store = { requestId: 'r-test', instances: new Map(), values: new Map() }
  return requestStore.run(store, () => fn(new RequestContext(req as never, res as never, next)))
}

describe('RequestContext read-only Proxy (dev)', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    // Ensure dev path is exercised even when the test runner sets
    // NODE_ENV=test (the Proxy gate only bypasses on 'production').
    vi.stubEnv('NODE_ENV', 'development')
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    warnSpy.mockRestore()
    vi.unstubAllEnvs()
  })

  it('warns and leaves the underlying body untouched when a field is reassigned', () => {
    const rawBody = { email: 'a@b.com', name: 'alice' }
    withCtx({ body: rawBody }, (ctx) => {
      const body = ctx.body as { email: string; name: string }
      // Strict-mode-safe: trap returns true so the assignment doesn't
      // throw — but the underlying object is not modified.
      body.email = 'evil@x.com'
      expect(rawBody.email).toBe('a@b.com')
      expect(warnSpy).toHaveBeenCalledTimes(1)
      expect(warnSpy.mock.calls[0][0]).toMatch(/ctx\.body\.email/)
      expect(warnSpy.mock.calls[0][0]).toMatch(/read-only/)
    })
  })

  it('warns on `delete ctx.params.foo` and leaves the field intact', () => {
    const rawParams = { id: '42' }
    withCtx({ params: rawParams }, (ctx) => {
      const params = ctx.params as { id: string }
      delete (params as Partial<typeof params>).id
      expect(rawParams.id).toBe('42')
      expect(warnSpy).toHaveBeenCalledTimes(1)
      expect(warnSpy.mock.calls[0][0]).toMatch(/delete.*ctx\.params\.id/)
    })
  })

  it('wraps query, headers, file, and files behind the same trap', () => {
    const rawFile = { originalname: 'x.png', size: 100 } as unknown as Express.Multer.File
    const rawFiles = [rawFile] as Express.Multer.File[]
    withCtx(
      {
        query: { page: '1' },
        headers: { 'x-tenant-id': 't-1' },
        file: rawFile,
        files: rawFiles,
      },
      (ctx) => {
        ;(ctx.query as { page: string }).page = '999'
        ;(ctx.headers as Record<string, string>)['x-tenant-id'] = 't-evil'
        ;(ctx.file as { originalname: string }).originalname = 'evil.png'
        ;(ctx.files as Express.Multer.File[])[0] = {
          originalname: 'replaced.png',
        } as Express.Multer.File

        // Underlying objects untouched.
        expect(rawFile.originalname).toBe('x.png')
        expect(rawFiles[0]).toBe(rawFile)
        expect(warnSpy).toHaveBeenCalledTimes(4)
      },
    )
  })

  it('returns the same proxy on repeat access (===-stable)', () => {
    // Router-builder constructs multiple RequestContext wrappers per
    // request (one each for middleware, contributors, and the main
    // handler). Adopters comparing `prev === next` across those
    // boundaries should see stable identity.
    withCtx({ body: { name: 'alice' } }, (ctx) => {
      expect(ctx.body).toBe(ctx.body)
    })
  })

  it('passes primitive / null bodies through unchanged', () => {
    withCtx({ body: null }, (ctx) => {
      expect(ctx.body).toBe(null)
    })
    withCtx({ body: 'hello' }, (ctx) => {
      expect(ctx.body).toBe('hello')
    })
  })

  it('reads on the proxy still reflect the raw object', () => {
    const rawBody = { greeting: 'hello' }
    withCtx({ body: rawBody }, (ctx) => {
      expect((ctx.body as { greeting: string }).greeting).toBe('hello')
    })
  })

  // ── Deep wrapping ──────────────────────────────────────────────────
  // Shallow-only would let `ctx.body.user.name = 'evil'`,
  // `ctx.files[0].fieldname = 'evil'`, and `ctx.body.tags.push(...)`
  // through unwarned — the most common shape of mutation on a typical
  // Zod-validated body. The `get` trap recursively wraps nested plain
  // objects and arrays on access so these surface a warning too.

  it('catches nested object mutations (ctx.body.user.name = ...)', () => {
    const rawBody = { user: { name: 'alice', email: 'a@b.com' } }
    withCtx({ body: rawBody }, (ctx) => {
      const body = ctx.body as { user: { name: string; email: string } }
      body.user.name = 'evil'
      expect(rawBody.user.name).toBe('alice')
      expect(warnSpy).toHaveBeenCalledTimes(1)
      expect(warnSpy.mock.calls[0][0]).toMatch(/ctx\.body\.user\.name/)
    })
  })

  it('catches mutations on an array element field (ctx.files[0].fieldname = ...)', () => {
    const rawFile = {
      originalname: 'x.png',
      size: 100,
    } as unknown as Express.Multer.File & { fieldname?: string }
    const rawFiles = [rawFile] as Express.Multer.File[]
    withCtx({ files: rawFiles }, (ctx) => {
      const files = ctx.files as (Express.Multer.File & { fieldname?: string })[]
      files[0].fieldname = 'evil'
      expect(rawFile.fieldname).toBeUndefined()
      expect(warnSpy).toHaveBeenCalledTimes(1)
      expect(warnSpy.mock.calls[0][0]).toMatch(/ctx\.files\.0\.fieldname/)
    })
  })

  it('catches array mutation methods (ctx.body.tags.push)', () => {
    // `Array.prototype.push` internally does `this[this.length] = x`
    // then bumps `length`. With the array wrapped, both writes hit
    // the `set` trap and warn — the original array is untouched.
    const rawBody = { tags: ['a', 'b'] as string[] }
    withCtx({ body: rawBody }, (ctx) => {
      const body = ctx.body as { tags: string[] }
      body.tags.push('evil')
      expect(rawBody.tags).toEqual(['a', 'b'])
      expect(warnSpy.mock.calls.length).toBeGreaterThan(0)
    })
  })

  it('keeps nested identity stable (ctx.body.user === ctx.body.user)', () => {
    withCtx({ body: { user: { name: 'a' } } }, (ctx) => {
      const a = (ctx.body as { user: object }).user
      const b = (ctx.body as { user: object }).user
      expect(a).toBe(b)
    })
  })

  it('terminates on cyclic refs (body.self = body)', () => {
    const rawBody: Record<string, unknown> = { name: 'alice' }
    rawBody.self = rawBody
    withCtx({ body: rawBody }, (ctx) => {
      // Drilling into a cycle must return the same proxy as the top
      // — the cache catches the second visit. Without this, the get
      // trap would StackOverflow on a recursive structure.
      const body = ctx.body as Record<string, unknown>
      expect(body.self).toBe(body)
    })
  })

  it('does not wrap non-plain objects (Date, Buffer pass through)', () => {
    // Express body-parser produces plain objects, but if an adopter's
    // middleware stashes a Date / Buffer on `req.body`, we leave it
    // alone — method dispatch and `instanceof` checks would break if
    // we wrapped them.
    const rawDate = new Date('2026-01-01')
    const rawBuf = Buffer.from('hello')
    const rawBody = { d: rawDate, b: rawBuf, n: 'alice' }
    withCtx({ body: rawBody }, (ctx) => {
      const body = ctx.body as { d: Date; b: Buffer; n: string }
      expect(body.d).toBe(rawDate)
      expect(body.b).toBe(rawBuf)
      expect(body.d instanceof Date).toBe(true)
      expect(Buffer.isBuffer(body.b)).toBe(true)
    })
  })
})

describe('RequestContext read-only Proxy (production)', () => {
  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'production')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('returns req.body as-is — no proxy, no warning, mutation lands on the underlying object', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const rawBody = { name: 'alice' }
    withCtx({ body: rawBody }, (ctx) => {
      expect(ctx.body).toBe(rawBody)
      ;(ctx.body as { name: string }).name = 'bob'
      // Hot path is identity — write lands directly.
      expect(rawBody.name).toBe('bob')
      expect(warnSpy).not.toHaveBeenCalled()
    })
    warnSpy.mockRestore()
  })
})
