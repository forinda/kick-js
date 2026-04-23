import 'reflect-metadata'
import { describe, it, expect } from 'vitest'
import { RequestContext, requestStore, type RequestStore } from '../src/index'

function mockReq() {
  return {
    body: {},
    params: {},
    query: {},
    headers: {},
  } as any
}

function mockResNext() {
  return [{ json: () => undefined } as any, (() => undefined) as any] as const
}

function makeStore(reqId = 'r-test'): RequestStore {
  return { requestId: reqId, instances: new Map(), values: new Map() }
}

function withStore<T>(fn: (store: RequestStore) => T, reqId = 'r-test'): T {
  const store = makeStore(reqId)
  return requestStore.run(store, () => fn(store))
}

describe('RequestContext metadata — ALS-active path (canonical)', () => {
  it('ctx.set writes into requestStore.getStore().values', () => {
    const req = mockReq()
    const [res, next] = mockResNext()

    withStore((store) => {
      const ctx = new RequestContext(req, res, next)
      ctx.set('user', { id: 'u-1' })
      expect(store.values.get('user')).toEqual({ id: 'u-1' })
    })
  })

  it('ctx.get reads from requestStore.getStore().values', () => {
    const req = mockReq()
    const [res, next] = mockResNext()

    withStore((store) => {
      store.values.set('tenant', { id: 't-9' })
      const ctx = new RequestContext(req, res, next)
      expect(ctx.get('tenant')).toEqual({ id: 't-9' })
    })
  })

  it('cross-visibility: ctx.set then external read via requestStore.getStore()', () => {
    const req = mockReq()
    const [res, next] = mockResNext()

    withStore((store) => {
      const ctx = new RequestContext(req, res, next)
      ctx.set('flag', true)
      const external = requestStore.getStore()!
      expect(external).toBe(store)
      expect(external.values.get('flag')).toBe(true)
    })
  })

  it('two ctx instances in the same request share the same backing map', () => {
    const req = mockReq()
    const [res, next] = mockResNext()

    withStore(() => {
      const a = new RequestContext(req, res, next)
      const b = new RequestContext(req, res, next)
      a.set('shared', 42)
      expect(b.get('shared')).toBe(42)
    })
  })

  it('does not write to req.__ctxMeta when ALS frame is active', () => {
    const req = mockReq()
    const [res, next] = mockResNext()

    withStore(() => {
      const ctx = new RequestContext(req, res, next)
      ctx.set('x', 1)
      expect(req.__ctxMeta).toBeUndefined()
    })
  })
})

describe('RequestContext metadata — store isolation across requests', () => {
  it('two requests with the same req object see independent stores', () => {
    const req = mockReq()
    const [res, next] = mockResNext()

    withStore((storeA) => {
      const ctxA = new RequestContext(req, res, next)
      ctxA.set('val', 'A')
      expect(storeA.values.get('val')).toBe('A')
    }, 'req-A')

    withStore((storeB) => {
      const ctxB = new RequestContext(req, res, next)
      // Storage from req-A must NOT leak into req-B's store.
      expect(ctxB.get('val')).toBeUndefined()
      ctxB.set('val', 'B')
      expect(storeB.values.get('val')).toBe('B')
    }, 'req-B')
  })
})

describe('RequestContext metadata — no ALS frame', () => {
  it('ctx.set throws when called outside requestStore.run(...)', () => {
    const req = mockReq()
    const [res, next] = mockResNext()
    const ctx = new RequestContext(req, res, next)

    expect(() => ctx.set('legacy', 'value')).toThrow(/AsyncLocalStorage frame/)
  })

  it('ctx.get returns undefined silently outside an ALS frame', () => {
    const req = mockReq()
    const [res, next] = mockResNext()
    const ctx = new RequestContext(req, res, next)

    expect(ctx.get('anything')).toBeUndefined()
  })

  it('ctx.user falls back to req.user outside an ALS frame', () => {
    const req = mockReq()
    req.user = { id: 'u-1' }
    const [res, next] = mockResNext()
    const ctx = new RequestContext(req, res, next)

    expect(ctx.user).toEqual({ id: 'u-1' })
  })
})
