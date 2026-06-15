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

  it("emits 'resolved' events with dedupe across rapid resolve calls", async () => {
    const events: { token: string; event: string }[] = []
    c.onChange((batch) => {
      for (const e of batch) events.push({ token: e.token, event: e.event })
    })

    @Service()
    class Hot {}
    c.register(Hot, Hot)

    // 100 resolves of the same token should collapse to one 'resolved'
    // entry in the debounced batch (token+event dedupe).
    for (let i = 0; i < 100; i++) c.resolve(Hot)
    c.flushChanges()

    const resolvedEvents = events.filter((e) => e.event === 'resolved' && e.token === 'Hot')
    expect(resolvedEvents).toHaveLength(1)
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

describe('Container change emit — zero-listener fast path', () => {
  let c: Container

  beforeEach(() => {
    // Decorators (@Service) register on the global container at definition
    // time; reset it per test so DI/decorator state can't leak between cases.
    Container.reset()
    c = Container.create()
  })

  it('buffers nothing while no listener is attached (no timer churn per resolve)', () => {
    @Service()
    class Hot {}
    c.register(Hot, Hot)

    // Resolve repeatedly with NO subscriber. The emit fast-path should
    // short-circuit, so nothing accumulates in the pending batch.
    for (let i = 0; i < 50; i++) c.resolve(Hot)

    // Attach AFTER the resolves and flush: a listener that subscribes late
    // must not receive a backlog of events it never asked for.
    const seen: string[] = []
    c.onChange((batch) => {
      for (const e of batch) seen.push(e.token)
    })
    c.flushChanges()
    expect(seen).toHaveLength(0)
  })

  it('still tracks resolveCount with no listener (registration state unaffected)', () => {
    @Service()
    class Counted {}
    c.register(Counted, Counted)

    for (let i = 0; i < 5; i++) c.resolve(Counted)

    const reg = c.getRegistrations().find((r) => r.token === 'Counted')
    expect(reg!.resolveCount).toBe(5)
  })

  it('emits normally once a listener is attached', () => {
    const seen: string[] = []
    @Service()
    class Live {}
    c.register(Live, Live)

    c.onChange((batch) => {
      for (const e of batch) seen.push(e.token)
    })
    c.resolve(Live)
    c.flushChanges()

    expect(seen).toContain('Live')
  })
})
