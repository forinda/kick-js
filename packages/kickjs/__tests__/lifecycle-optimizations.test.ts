import 'reflect-metadata'
import { describe, it, expect, beforeEach } from 'vitest'

import { ref, computed, watch, reactive } from '../src/core/reactivity'
import { MemoryCacheProvider, Cacheable, setCacheProvider } from '../src/core/cache'
import { Container } from '../src/core/container'
import { Service, PreDestroy, Autowired } from '../src/core/decorators'
import { Scope } from '../src/core/interfaces'
import { requestStore, type RequestStore } from '../src/http/request-store'
import { createRequestStore, disposeRequestStore } from '../src/http/middleware/request-scope'

/**
 * Locks in the object-lifecycle fixes from the framework audit:
 * reactivity effect cleanup, bounded LRU cache + cached-null sentinel,
 * and @PreDestroy teardown for REQUEST-scoped instances.
 */

describe('reactivity — effect cleanup', () => {
  it('watch stop() detaches the effect so the callback never fires again', () => {
    const count = ref(0)
    let calls = 0
    const stop = watch(count, () => calls++)
    count.value = 1
    expect(calls).toBe(1)
    stop()
    count.value = 2
    expect(calls).toBe(1)
  })

  it('conditional getter drops the branch it no longer reads', () => {
    const cond = ref(true)
    const a = ref('a')
    const b = ref('b')
    let calls = 0
    watch(
      () => (cond.value ? a.value : b.value),
      () => calls++,
    )
    cond.value = false // now reads b, must drop a's subscription
    expect(calls).toBe(1)
    a.value = 'a2' // stale dep — must NOT fire
    expect(calls).toBe(1)
    b.value = 'b2' // live dep — must fire
    expect(calls).toBe(2)
  })

  it('computed dispose() detaches from sources; reads still work untracked', () => {
    const count = ref(1)
    const doubled = computed(() => count.value * 2)
    expect(doubled.value).toBe(2)
    doubled.dispose()
    count.value = 5
    expect(doubled.value).toBe(10) // recomputes on demand, untracked
  })

  it('reactive() returns a stable proxy for nested objects', () => {
    const state = reactive({ nested: { x: 1 } })
    expect(state.nested).toBe(state.nested)
  })
})

describe('MemoryCacheProvider — bounds and null caching', () => {
  it('evicts least-recently-used entries at maxEntries', async () => {
    const cache = new MemoryCacheProvider(2)
    await cache.set('a', 1, 60_000)
    await cache.set('b', 2, 60_000)
    await cache.get('a') // touch a → b is now LRU
    await cache.set('c', 3, 60_000) // evicts b
    expect(await cache.get('a')).toBe(1)
    expect(await cache.get('b')).toBeNull()
    expect(await cache.get('c')).toBe(3)
  })

  it('@Cacheable serves cached null instead of re-executing', async () => {
    setCacheProvider(new MemoryCacheProvider())
    let executions = 0
    class Repo {
      @Cacheable(60)
      async find(_id: string): Promise<string | null> {
        executions++
        return null
      }
    }
    const repo = new Repo()
    expect(await repo.find('x')).toBeNull()
    expect(await repo.find('x')).toBeNull()
    expect(executions).toBe(1)
  })
})

describe('@PreDestroy — REQUEST-scope teardown', () => {
  beforeEach(() => {
    Container.reset()
  })

  it('runs the hook when the request store is disposed, once', () => {
    let destroyed = 0

    @Service({ scope: Scope.REQUEST })
    class TxService {
      @PreDestroy()
      close(): void {
        destroyed++
      }
    }

    Container._requestStoreProvider = () => requestStore.getStore()
    const container = Container.getInstance()
    const store: RequestStore = createRequestStore()
    requestStore.run(store, () => {
      const svc = container.resolve(TxService)
      expect(svc).toBeInstanceOf(TxService)
    })
    expect(destroyed).toBe(0)
    disposeRequestStore(store)
    disposeRequestStore(store) // idempotent
    expect(destroyed).toBe(1)
    expect(store.instances.size).toBe(0)
  })
})

describe('@Autowired — singleton memoization', () => {
  beforeEach(() => {
    Container.reset()
  })

  it('memoizes singleton deps as a data property after first read', () => {
    @Service()
    class Dep {}

    @Service()
    class Owner {
      @Autowired()
      dep!: Dep
    }

    const owner = Container.getInstance().resolve(Owner)
    const first = owner.dep // triggers memoization
    expect(owner.dep).toBe(first)
    // After first read the property must be a plain value, not a getter.
    const desc = Object.getOwnPropertyDescriptor(owner, 'dep')
    expect(desc?.get).toBeUndefined()
    expect(desc?.value).toBe(first)
  })
})
