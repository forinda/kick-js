# Caching

KickJS provides `@Cacheable` and `@CacheEvict` decorators with a pluggable cache backend. By default, an in-memory `Map` is used. Swap in Redis, Memcached, or any custom store by implementing the `CacheProvider` interface.

## Quick Start

```ts
import { Service, Cacheable, CacheEvict } from '@forinda/kickjs'

@Service()
export class ProductService {
  // Cache for 5 minutes
  @Cacheable(300, { key: 'products' })
  async findAll() {
    return db.products.findMany()
  }

  // Cache individual lookups for 10 minutes
  @Cacheable(600, { key: 'product' })
  async findById(id: string) {
    return db.products.findUnique({ where: { id } })
  }

  // Evict the products cache when data changes
  @CacheEvict('products')
  async create(data: any) {
    return db.products.create({ data })
  }

  @CacheEvict('product')
  async update(id: string, data: any) {
    return db.products.update({ where: { id }, data })
  }
}
```

That's it — caching works out of the box with the built-in memory provider.

## Custom Cache Provider

Implement the `CacheProvider` interface to use any backend:

```ts
import type { CacheProvider } from '@forinda/kickjs'

export interface CacheProvider {
  get(key: string): Promise<any | null>
  set(key: string, value: any, ttlMs: number): Promise<void>
  del(key: string): Promise<void>
  delByPrefix?(prefix: string): Promise<void>
  shutdown?(): Promise<void>
}
```

### Redis Example

```ts
import type { CacheProvider } from '@forinda/kickjs'
import Redis from 'ioredis'

export class RedisCacheProvider implements CacheProvider {
  private client: Redis

  constructor(url?: string) {
    this.client = new Redis(url)
  }

  async get(key: string): Promise<any | null> {
    const val = await this.client.get(key)
    return val ? JSON.parse(val) : null
  }

  async set(key: string, value: any, ttlMs: number): Promise<void> {
    await this.client.set(key, JSON.stringify(value), 'PX', ttlMs)
  }

  async del(key: string): Promise<void> {
    await this.client.del(key)
  }

  async delByPrefix(prefix: string): Promise<void> {
    const keys = await this.client.keys(`${prefix}*`)
    if (keys.length > 0) {
      await this.client.del(...keys)
    }
  }

  async shutdown(): Promise<void> {
    await this.client.quit()
  }
}
```

### Registering Your Provider

Call `setCacheProvider()` before bootstrapping:

```ts
import { setCacheProvider } from '@forinda/kickjs'
import { RedisCacheProvider } from './redis-cache'

// Use Redis for all @Cacheable/@CacheEvict
setCacheProvider(new RedisCacheProvider('redis://localhost:6379'))

bootstrap({ modules: [...], adapters: [...] })
```

## Built-in Providers

### MemoryCacheProvider (default)

In-memory `Map`-based cache. Works out of the box, no configuration needed.

- Suitable for development and single-instance deployments
- Data is lost on restart
- No cross-process sharing

```ts
import { setCacheProvider, MemoryCacheProvider } from '@forinda/kickjs'

// This is the default — you only need this if you want to reset
setCacheProvider(new MemoryCacheProvider())
```

## How Cache Keys Work

The cache key is constructed as `{prefix}:{JSON.stringify(args)}`:

- **prefix** defaults to the method name, or can be set via `options.key`
- **args** are the method arguments, serialized to JSON

This means `findById('abc')` and `findById('xyz')` get separate cache entries, while `findAll()` with no args is cached under `{prefix}:[]`.

## @CacheEvict

`@CacheEvict(key)` deletes all cache entries whose key starts with the given prefix. This is called **after** the decorated method completes successfully.

```ts
// Caches under "users:..." prefix
@Cacheable(300, { key: 'users' })
async listUsers() { ... }

// Evicts all "users:..." entries
@CacheEvict('users')
async createUser(data: any) { ... }
```

For this to work across methods, both decorators must use the same `key` prefix, and your `CacheProvider` must implement `delByPrefix`.

## API Reference

### `@Cacheable(ttl?, options?)`

| Param | Type | Default | Description |
|---|---|---|---|
| `ttl` | `number` | `60` | Time-to-live in **seconds** |
| `options.key` | `string` | method name | Cache key prefix |

### `@CacheEvict(key)`

| Param | Type | Description |
|---|---|---|
| `key` | `string` | Cache key prefix to evict |

### `setCacheProvider(provider)`

Set the global cache provider. Call before `bootstrap()`.

### `getCacheProvider()`

Returns the currently active `CacheProvider` instance.

### `MemoryCacheProvider`

Built-in provider using an in-memory `Map`. This is the default.
