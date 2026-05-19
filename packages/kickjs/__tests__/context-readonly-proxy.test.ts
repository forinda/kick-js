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
      expect(warnSpy.mock.calls[0][0]).toMatch(/delete ctx\.params\.id/)
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
