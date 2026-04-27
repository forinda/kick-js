import 'reflect-metadata'
import { describe, it, expect, beforeEach } from 'vitest'

import { Container, Service, Inject, Autowired, createToken } from '../src'

describe('Container introspection — dependency capture', () => {
  let c: Container

  beforeEach(() => {
    c = Container.create()
  })

  it('captures @Inject constructor params in dependencies', () => {
    const DB_TOKEN = createToken<{ ping: () => string }>('DB')
    c.registerFactory(DB_TOKEN, () => ({ ping: () => 'pong' }))

    @Service()
    class UsesCtorInject {
      constructor(@Inject(DB_TOKEN) public db: { ping: () => string }) {}
    }

    c.register(UsesCtorInject, UsesCtorInject)
    const reg = c.getRegistrations().find((r) => r.token === 'UsesCtorInject')
    expect(reg).toBeDefined()
    expect(reg!.dependencies).toContain('DB')
  })

  it('captures @Autowired property deps in dependencies (regression for stale empty array)', () => {
    const CACHE_TOKEN = createToken<{ get: (k: string) => string }>('CACHE')
    c.registerFactory(CACHE_TOKEN, () => ({ get: (k: string) => k }))

    @Service()
    class UsesAutowired {
      @Autowired(CACHE_TOKEN)
      cache!: { get: (k: string) => string }
    }

    c.register(UsesAutowired, UsesAutowired)
    const reg = c.getRegistrations().find((r) => r.token === 'UsesAutowired')
    expect(reg).toBeDefined()
    expect(reg!.dependencies).toContain('CACHE')
  })

  it('merges ctor + property deps, deduping when the same token appears in both', () => {
    const SHARED = createToken<{ id: string }>('SHARED')
    c.registerFactory(SHARED, () => ({ id: 'x' }))

    @Service()
    class Both {
      @Autowired(SHARED)
      via_property!: { id: string }
      constructor(@Inject(SHARED) public via_ctor: { id: string }) {}
    }

    c.register(Both, Both)
    const reg = c.getRegistrations().find((r) => r.token === 'Both')
    expect(reg).toBeDefined()
    // SHARED appears once even though declared on both surfaces.
    const sharedHits = reg!.dependencies.filter((d) => d === 'SHARED').length
    expect(sharedHits).toBe(1)
  })

  it('reports no dependencies for a class with neither @Inject nor @Autowired', () => {
    @Service()
    class Plain {
      hello() {
        return 'world'
      }
    }
    c.register(Plain, Plain)
    const reg = c.getRegistrations().find((r) => r.token === 'Plain')
    expect(reg).toBeDefined()
    expect(reg!.dependencies).toEqual([])
  })
})
