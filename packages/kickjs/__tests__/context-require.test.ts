import 'reflect-metadata'
import { describe, it, expect } from 'vitest'
import {
  MissingContextValueError,
  RequestContext,
  requestStore,
  type RequestStore,
} from '../src/index'

// `ctx.get(key)` returns `T | undefined` for every key, so the only way
// to consume a value a contributor guarantees was `ctx.get(key)!` — a
// non-null assertion that compiles whether or not the producing
// contributor is applied to the route. On an authorization value that
// makes a dropped decorator invisible to both tsc and the runtime.
// `ctx.require()` is the loud version.

function mockReq(over: Record<string, unknown> = {}) {
  return { body: {}, params: {}, query: {}, headers: {}, ...over } as any
}

function mockResNext() {
  return [{ json: () => undefined } as any, (() => undefined) as any] as const
}

function withStore<T>(fn: (store: RequestStore) => T): T {
  const store: RequestStore = { requestId: 'r-test', instances: new Map(), values: new Map() }
  return requestStore.run(store, () => fn(store))
}

describe('RequestContext.require', () => {
  it('returns the value when a contributor produced it', () => {
    withStore((store) => {
      store.values.set('tenant', { id: 't-9' })
      const ctx = new RequestContext(mockReq(), ...mockResNext())
      expect(ctx.require('tenant')).toEqual({ id: 't-9' })
    })
  })

  it('throws MissingContextValueError when the key was never written', () => {
    withStore(() => {
      const ctx = new RequestContext(mockReq(), ...mockResNext())
      expect(() => ctx.require('tenantPerm')).toThrow(MissingContextValueError)
    })
  })

  it('names the missing key and the route in the message', () => {
    withStore(() => {
      const ctx = new RequestContext(
        mockReq({ method: 'GET', url: '/projects/42' }),
        ...mockResNext(),
      )
      let caught: MissingContextValueError | undefined
      try {
        ctx.require('tenantPerm')
      } catch (e) {
        caught = e as MissingContextValueError
      }
      expect(caught?.key).toBe('tenantPerm')
      expect(caught?.route).toBe('GET /projects/42')
      expect(caught?.message).toContain('tenantPerm')
      expect(caught?.message).toContain('GET /projects/42')
    })
  })

  it('treats null as a real value — only undefined throws', () => {
    // A contributor resolving to null is saying "looked, found nothing",
    // which is a decision. undefined means nothing ran at all.
    withStore((store) => {
      store.values.set('lookup', null)
      const ctx = new RequestContext(mockReq(), ...mockResNext())
      expect(ctx.require('lookup')).toBeNull()
    })
  })

  it('throws for a key explicitly set to undefined', () => {
    withStore((store) => {
      store.values.set('maybe', undefined)
      const ctx = new RequestContext(mockReq(), ...mockResNext())
      expect(() => ctx.require('maybe')).toThrow(MissingContextValueError)
    })
  })

  it('still throws (does not crash differently) with no ALS frame active', () => {
    // Outside a request store there is no metadata map at all. require()
    // should report the missing key, not a TypeError on undefined.
    const ctx = new RequestContext(mockReq(), ...mockResNext())
    expect(() => ctx.require('tenant')).toThrow(MissingContextValueError)
  })

  it('omits the route suffix when the request exposes no method/url', () => {
    withStore(() => {
      const ctx = new RequestContext(mockReq(), ...mockResNext())
      const err = (() => {
        try {
          ctx.require('x')
        } catch (e) {
          return e as MissingContextValueError
        }
      })()
      expect(err?.route).toBeUndefined()
      expect(err?.message).toContain("No context value for 'x'")
    })
  })
})
