import { describe, it, expect, vi } from 'vitest'
import { createInertiaMiddleware } from '../src/inertia-middleware'
import type { InertiaConfig } from '../src/types'
import { Inertia } from '../src/inertia'

function createMockReqRes(
  headers: Record<string, string> = {},
  method = 'GET',
  url = '/test',
) {
  const metadata = new Map<string, any>()
  const req = {
    url,
    method,
    headers: { ...headers },
    __kickRequestContext: {
      req: { url, method, headers: { ...headers } },
      res: null as any,
      next: vi.fn(),
      get: (key: string) => metadata.get(key),
      set: (key: string, value: any) => metadata.set(key, value),
    },
  }
  const res = {
    statusCode: 200,
    status: vi.fn(function (this: any, code: number) {
      this.statusCode = code
      return this
    }),
    setHeader: vi.fn().mockReturnThis(),
    end: vi.fn(),
    writeHead: vi.fn(function (this: any, code: number, ...args: any[]) {
      this.statusCode = code
      return this
    }),
  }
  req.__kickRequestContext.res = res
  return { req, res, ctx: req.__kickRequestContext, metadata }
}

function createConfig(overrides: Partial<InertiaConfig> = {}): InertiaConfig {
  return {
    rootView: '<html></html>',
    version: () => 'v1',
    ssr: { enabled: false },
    share: () => ({}),
    ...overrides,
  } as InertiaConfig
}

describe('createInertiaMiddleware()', () => {
  it('creates an Inertia instance on ctx for every request', async () => {
    const config = createConfig()
    const middleware = createInertiaMiddleware(config)
    const { req, res, ctx } = createMockReqRes()
    const next = vi.fn()

    await middleware(req as any, res as any, next)

    expect(ctx.get('inertia')).toBeInstanceOf(Inertia)
    expect(next).toHaveBeenCalled()
  })

  it('calls config.share() and passes data to instance', async () => {
    const shareFn = vi.fn().mockResolvedValue({ auth: { user: 'test' } })
    const config = createConfig({ share: shareFn })
    const middleware = createInertiaMiddleware(config)
    const { req, res } = createMockReqRes()
    const next = vi.fn()

    await middleware(req as any, res as any, next)

    expect(shareFn).toHaveBeenCalled()
  })

  it('non-Inertia requests pass through unmodified', async () => {
    const config = createConfig()
    const middleware = createInertiaMiddleware(config)
    const { req, res } = createMockReqRes()
    const next = vi.fn()

    await middleware(req as any, res as any, next)

    expect(res.status).not.toHaveBeenCalled()
    expect(next).toHaveBeenCalled()
  })

  it('returns 409 on version mismatch for Inertia requests', async () => {
    const config = createConfig({ version: () => 'server-v2' })
    const middleware = createInertiaMiddleware(config)
    const { req, res } = createMockReqRes({
      'x-inertia': 'true',
      'x-inertia-version': 'client-v1',
    })
    const next = vi.fn()

    await middleware(req as any, res as any, next)

    expect(res.status).toHaveBeenCalledWith(409)
    expect(res.setHeader).toHaveBeenCalledWith('X-Inertia-Location', '/test')
    expect(res.end).toHaveBeenCalled()
    expect(next).not.toHaveBeenCalled()
  })

  it('does not 409 when versions match', async () => {
    const config = createConfig({ version: () => 'v1' })
    const middleware = createInertiaMiddleware(config)
    const { req, res } = createMockReqRes({
      'x-inertia': 'true',
      'x-inertia-version': 'v1',
    })
    const next = vi.fn()

    await middleware(req as any, res as any, next)

    expect(res.status).not.toHaveBeenCalledWith(409)
    expect(next).toHaveBeenCalled()
  })

  it('rewrites 302 to 303 for PUT/PATCH/DELETE Inertia requests', async () => {
    for (const method of ['PUT', 'PATCH', 'DELETE']) {
      const config = createConfig()
      const middleware = createInertiaMiddleware(config)
      const { req, res } = createMockReqRes({ 'x-inertia': 'true' }, method)
      const next = vi.fn()

      await middleware(req as any, res as any, next)

      // Simulate Express calling writeHead with 302
      res.writeHead(302)
      expect(res.statusCode).toBe(303)
    }
  })

  it('does not rewrite 302 for GET Inertia requests', async () => {
    const config = createConfig()
    const middleware = createInertiaMiddleware(config)
    const { req, res } = createMockReqRes({ 'x-inertia': 'true' }, 'GET')
    const next = vi.fn()

    await middleware(req as any, res as any, next)

    // writeHead should not be intercepted for GET
    res.writeHead(302)
    expect(res.statusCode).toBe(302)
  })
})
