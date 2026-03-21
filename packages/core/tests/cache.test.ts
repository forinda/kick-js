import { describe, it, expect, beforeEach, vi } from 'vitest'
import 'reflect-metadata'
import {
  Cacheable,
  CacheEvict,
  setCacheProvider,
  getCacheProvider,
  MemoryCacheProvider,
  type CacheProvider,
} from '@forinda/kickjs-core'

describe('MemoryCacheProvider', () => {
  let provider: MemoryCacheProvider

  beforeEach(() => {
    provider = new MemoryCacheProvider()
  })

  it('returns null for missing keys', async () => {
    expect(await provider.get('nonexistent')).toBeNull()
  })

  it('stores and retrieves a value', async () => {
    await provider.set('key1', { name: 'test' }, 60000)
    expect(await provider.get('key1')).toEqual({ name: 'test' })
  })

  it('respects TTL expiration', async () => {
    vi.useFakeTimers()
    await provider.set('key1', 'value', 1000)

    expect(await provider.get('key1')).toBe('value')

    vi.advanceTimersByTime(1001)
    expect(await provider.get('key1')).toBeNull()

    vi.useRealTimers()
  })

  it('deletes a specific key', async () => {
    await provider.set('key1', 'value1', 60000)
    await provider.set('key2', 'value2', 60000)

    await provider.del('key1')
    expect(await provider.get('key1')).toBeNull()
    expect(await provider.get('key2')).toBe('value2')
  })

  it('deletes by prefix', async () => {
    await provider.set('users:1', 'alice', 60000)
    await provider.set('users:2', 'bob', 60000)
    await provider.set('products:1', 'widget', 60000)

    await provider.delByPrefix('users')
    expect(await provider.get('users:1')).toBeNull()
    expect(await provider.get('users:2')).toBeNull()
    expect(await provider.get('products:1')).toBe('widget')
  })

  it('clears all on shutdown', async () => {
    await provider.set('key1', 'a', 60000)
    await provider.set('key2', 'b', 60000)

    await provider.shutdown()
    expect(await provider.get('key1')).toBeNull()
    expect(await provider.get('key2')).toBeNull()
  })
})

describe('setCacheProvider / getCacheProvider', () => {
  beforeEach(() => {
    setCacheProvider(new MemoryCacheProvider())
  })

  it('returns the default MemoryCacheProvider', () => {
    expect(getCacheProvider()).toBeInstanceOf(MemoryCacheProvider)
  })

  it('swaps to a custom provider', () => {
    const custom: CacheProvider = {
      get: vi.fn(),
      set: vi.fn(),
      del: vi.fn(),
    }
    setCacheProvider(custom)
    expect(getCacheProvider()).toBe(custom)
  })
})

describe('@Cacheable', () => {
  beforeEach(() => {
    setCacheProvider(new MemoryCacheProvider())
  })

  it('caches method return value', async () => {
    let callCount = 0

    class UserService {
      @Cacheable(60, { key: 'users' })
      async findAll() {
        callCount++
        return [{ id: 1, name: 'Alice' }]
      }
    }

    const svc = new UserService()

    const result1 = await svc.findAll()
    const result2 = await svc.findAll()

    expect(result1).toEqual([{ id: 1, name: 'Alice' }])
    expect(result2).toEqual([{ id: 1, name: 'Alice' }])
    expect(callCount).toBe(1) // Only called once — second was cached
  })

  it('caches different args separately', async () => {
    let callCount = 0

    class ProductService {
      @Cacheable(60, { key: 'product' })
      async findById(id: string) {
        callCount++
        return { id, name: `Product ${id}` }
      }
    }

    const svc = new ProductService()

    await svc.findById('a')
    await svc.findById('b')
    await svc.findById('a') // cached

    expect(callCount).toBe(2) // 'a' and 'b', second 'a' is cached
  })

  it('expires after TTL', async () => {
    vi.useFakeTimers()
    let callCount = 0

    class Svc {
      @Cacheable(1, { key: 'data' }) // 1 second TTL
      async getData() {
        callCount++
        return 'fresh'
      }
    }

    const svc = new Svc()
    await svc.getData()
    expect(callCount).toBe(1)

    vi.advanceTimersByTime(1001)
    await svc.getData()
    expect(callCount).toBe(2) // Re-fetched after expiry

    vi.useRealTimers()
  })

  it('uses method name as default key prefix', async () => {
    const provider = getCacheProvider()
    const getSpy = vi.spyOn(provider, 'get')

    class Svc {
      @Cacheable(60)
      async myMethod() {
        return 'val'
      }
    }

    const svc = new Svc()
    await svc.myMethod()

    expect(getSpy).toHaveBeenCalledWith('myMethod:[]')
  })
})

describe('@CacheEvict', () => {
  beforeEach(() => {
    setCacheProvider(new MemoryCacheProvider())
  })

  it('evicts cache entries by prefix after method runs', async () => {
    let fetchCount = 0

    class ItemService {
      @Cacheable(60, { key: 'items' })
      async findAll() {
        fetchCount++
        return ['a', 'b']
      }

      @CacheEvict('items')
      async create(name: string) {
        return name
      }
    }

    const svc = new ItemService()

    // Populate cache
    await svc.findAll()
    expect(fetchCount).toBe(1)

    // Still cached
    await svc.findAll()
    expect(fetchCount).toBe(1)

    // Evict
    await svc.create('c')

    // Should re-fetch
    await svc.findAll()
    expect(fetchCount).toBe(2)
  })

  it('returns the method result unchanged', async () => {
    class Svc {
      @CacheEvict('stuff')
      async doSomething() {
        return { success: true }
      }
    }

    const svc = new Svc()
    const result = await svc.doSomething()
    expect(result).toEqual({ success: true })
  })
})

describe('Custom CacheProvider integration', () => {
  it('uses a custom provider for @Cacheable', async () => {
    const store = new Map<string, any>()

    const custom: CacheProvider = {
      get: vi.fn(async (key) => store.get(key) ?? null),
      set: vi.fn(async (key, value) => {
        store.set(key, value)
      }),
      del: vi.fn(async (key) => {
        store.delete(key)
      }),
    }

    setCacheProvider(custom)

    class Svc {
      @Cacheable(60, { key: 'test' })
      async getData() {
        return 42
      }
    }

    const svc = new Svc()
    await svc.getData()
    await svc.getData()

    expect(custom.get).toHaveBeenCalledTimes(2)
    expect(custom.set).toHaveBeenCalledTimes(1) // Only set once
  })
})
