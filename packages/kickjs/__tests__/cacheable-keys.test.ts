import { describe, it, expect, beforeEach } from 'vitest'
import { Cacheable, CacheEvict, MemoryCacheProvider, setCacheProvider } from '../src/core/cache'

let provider: MemoryCacheProvider

beforeEach(() => {
  provider = new MemoryCacheProvider()
  setCacheProvider(provider)
})

describe('@Cacheable keys', () => {
  it('does not share entries between classes with the same method name', async () => {
    class UserService {
      @Cacheable(60)
      async findAll() {
        return ['user']
      }
    }
    class PostService {
      @Cacheable(60)
      async findAll() {
        return ['post']
      }
    }

    expect(await new UserService().findAll()).toEqual(['user'])
    expect(await new PostService().findAll()).toEqual(['post'])
  })

  it('keeps the method name as the default prefix, so @CacheEvict(methodName) still evicts', async () => {
    let calls = 0
    class Repo {
      @Cacheable(60)
      async list() {
        calls++
        return calls
      }

      @CacheEvict('list')
      async add() {}
    }
    const repo = new Repo()

    expect(await repo.list()).toBe(1)
    expect(await repo.list()).toBe(1)
    await repo.add()
    expect(await repo.list()).toBe(2)
  })

  it('leaves an explicit key untouched, so classes can share it on purpose', async () => {
    class A {
      @Cacheable(60, { key: 'shared' })
      async get() {
        return 'a'
      }
    }
    class B {
      @Cacheable(60, { key: 'shared' })
      async get() {
        return 'b'
      }
    }

    expect(await new A().get()).toBe('a')
    expect(await new B().get()).toBe('a')
    expect(await provider.get('shared:[]')).toBe('a')
  })
})

describe('@Cacheable concurrent misses', () => {
  it('runs the method once for simultaneous misses on the same key', async () => {
    let calls = 0
    let release!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    class Svc {
      @Cacheable(60)
      async load(id: string) {
        calls++
        await gate
        return `v:${id}`
      }
    }
    const svc = new Svc()

    const all = Promise.all([svc.load('1'), svc.load('1'), svc.load('1'), svc.load('2')])
    release()
    expect(await all).toEqual(['v:1', 'v:1', 'v:1', 'v:2'])
    expect(calls).toBe(2) // one per distinct key
  })

  it('lets the next call retry after a failed load', async () => {
    let calls = 0
    class Svc {
      @Cacheable(60)
      async load() {
        calls++
        if (calls === 1) throw new Error('boom')
        return 'ok'
      }
    }
    const svc = new Svc()

    const [a, b] = await Promise.allSettled([svc.load(), svc.load()])
    expect(a.status).toBe('rejected')
    expect(b.status).toBe('rejected') // shared the failing in-flight call
    expect(await svc.load()).toBe('ok')
    expect(calls).toBe(2)
  })
})
