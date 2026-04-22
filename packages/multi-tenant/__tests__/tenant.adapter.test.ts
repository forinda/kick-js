import 'reflect-metadata'
import { describe, it, expect, beforeEach } from 'vitest'
import { Container, type AdapterContext } from '@forinda/kickjs'
import { TenantAdapter, TENANT_CONTEXT } from '../src/index'
import { tenantStorage } from '../src/tenant.context'
import type { Request, Response, NextFunction } from 'express'

beforeEach(() => {
  Container.reset()
})

const fakeReq = (overrides: Partial<Request> = {}): Request => {
  const headers = new Map<string, string>()
  return {
    path: '/',
    hostname: 'example.com',
    query: {},
    get: (name: string) => headers.get(name.toLowerCase()),
    ...overrides,
    // tiny shim — overrides may set headers below
  } as unknown as Request
}

const reqWithHeaders = (h: Record<string, string>): Request => {
  const lowered = new Map(Object.entries(h).map(([k, v]) => [k.toLowerCase(), v]))
  return {
    path: '/',
    hostname: 'example.com',
    query: {},
    get: (name: string) => lowered.get(name.toLowerCase()),
  } as unknown as Request
}

const fakeRes = () => {
  const calls: { status?: number; body?: unknown } = {}
  const res = {
    status(code: number) {
      calls.status = code
      return res
    },
    json(body: unknown) {
      calls.body = body
      return res
    },
  } as unknown as Response
  return { res, calls }
}

const runMiddleware = async (
  adapter: ReturnType<typeof TenantAdapter>,
  req: Request,
  res: Response,
): Promise<{ nextCalled: boolean }> => {
  const entries = adapter.middleware!()
  expect(entries).toHaveLength(1)
  let nextCalled = false
  const next: NextFunction = () => {
    nextCalled = true
  }
  await entries[0].handler(req, res, next)
  return { nextCalled }
}

describe('TenantAdapter — factory shape', () => {
  it('exposes the documented adapter name', () => {
    const adapter = TenantAdapter()
    expect(adapter.name).toBe('TenantAdapter')
  })

  it('namespaces .scoped() instances with `${name}:${scope}`', () => {
    const eu = TenantAdapter.scoped('eu', { strategy: 'header', headerName: 'x-eu-tenant' })
    const us = TenantAdapter.scoped('us', { strategy: 'header', headerName: 'x-us-tenant' })
    expect(eu.name).toBe('TenantAdapter:eu')
    expect(us.name).toBe('TenantAdapter:us')
  })

})

describe('TenantAdapter — header strategy', () => {
  it('resolves tenant from x-tenant-id by default', async () => {
    const adapter = TenantAdapter({ strategy: 'header' })
    const req = reqWithHeaders({ 'x-tenant-id': 'acme' })
    const { res, calls } = fakeRes()

    let resolvedInside: { id: string } | undefined
    await new Promise<void>((resolve) => {
      const next: NextFunction = () => {
        resolvedInside = tenantStorage.getStore()
        resolve()
      }
      adapter.middleware!()[0].handler(req, res, next)
    })
    expect(resolvedInside).toEqual({ id: 'acme' })
    expect(calls.status).toBeUndefined()
    expect((req as unknown as { tenant: { id: string } }).tenant).toEqual({ id: 'acme' })
  })

  it('honours a custom headerName override', async () => {
    const adapter = TenantAdapter({ strategy: 'header', headerName: 'x-org' })
    const req = reqWithHeaders({ 'x-org': 'beta' })
    const { res } = fakeRes()
    let resolvedInside: { id: string } | undefined
    await new Promise<void>((resolve) => {
      const next: NextFunction = () => {
        resolvedInside = tenantStorage.getStore()
        resolve()
      }
      adapter.middleware!()[0].handler(req, res, next)
    })
    expect(resolvedInside).toEqual({ id: 'beta' })
  })
})

describe('TenantAdapter — required option', () => {
  it('returns 403 when required: true and no tenant header is present', async () => {
    const adapter = TenantAdapter({ strategy: 'header' })
    const req = fakeReq()
    const { res, calls } = fakeRes()
    const { nextCalled } = await runMiddleware(adapter, req, res)
    expect(nextCalled).toBe(false)
    expect(calls.status).toBe(403)
  })

  it('passes through when required: false and no tenant is resolvable', async () => {
    const adapter = TenantAdapter({ strategy: 'header', required: false })
    const req = fakeReq()
    const { res, calls } = fakeRes()
    const { nextCalled } = await runMiddleware(adapter, req, res)
    expect(nextCalled).toBe(true)
    expect(calls.status).toBeUndefined()
  })
})

describe('TenantAdapter — excludeRoutes', () => {
  it('skips tenant resolution for excluded paths', async () => {
    const adapter = TenantAdapter({
      strategy: 'header',
      required: true,
      excludeRoutes: ['/health'],
    })
    const req = fakeReq({ path: '/health/ready' })
    const { res, calls } = fakeRes()
    const { nextCalled } = await runMiddleware(adapter, req, res)
    expect(nextCalled).toBe(true)
    expect(calls.status).toBeUndefined()
  })
})

describe('TenantAdapter — custom strategy', () => {
  it('invokes the custom resolver and uses its result', async () => {
    const adapter = TenantAdapter({
      strategy: () => ({ id: 'from-custom-fn' }),
    })
    const req = fakeReq()
    const { res } = fakeRes()
    let resolvedInside: { id: string } | undefined
    await new Promise<void>((resolve) => {
      const next: NextFunction = () => {
        resolvedInside = tenantStorage.getStore()
        resolve()
      }
      adapter.middleware!()[0].handler(req, res, next)
    })
    expect(resolvedInside).toEqual({ id: 'from-custom-fn' })
  })
})

describe('TenantAdapter — onTenantResolved hook', () => {
  it('fires the hook before next() with the resolved tenant + request', async () => {
    const events: string[] = []
    const adapter = TenantAdapter({
      strategy: 'header',
      onTenantResolved: async (tenant, req) => {
        events.push(`hook:${tenant.id}:${(req as Request).path}`)
      },
    })
    const req = reqWithHeaders({ 'x-tenant-id': 'acme' })
    ;(req as unknown as { path: string }).path = '/orders'

    const { res } = fakeRes()
    await new Promise<void>((resolve) => {
      const next: NextFunction = () => {
        events.push('next')
        resolve()
      }
      adapter.middleware!()[0].handler(req, res, next)
    })
    expect(events).toEqual(['hook:acme:/orders', 'next'])
  })
})

describe('TenantAdapter — beforeStart DI registration', () => {
  it('registers TENANT_CONTEXT as a TRANSIENT factory pulling from AsyncLocalStorage', async () => {
    const adapter = TenantAdapter({ strategy: 'header' })
    const container = Container.create()
    const ctx = { container, app: {}, env: 'test', isProduction: false } as AdapterContext
    await adapter.beforeStart!(ctx)

    // No active request → factory must throw the documented diagnostic.
    expect(() => container.resolve(TENANT_CONTEXT)).toThrow(/TENANT_CONTEXT resolved outside/)

    // Inside an AsyncLocalStorage frame → factory returns the active tenant.
    tenantStorage.run({ id: 't-99' }, () => {
      expect(container.resolve(TENANT_CONTEXT)).toEqual({ id: 't-99' })
    })
  })
})
