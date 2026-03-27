import 'reflect-metadata'

const CACHEABLE_META = Symbol('kick:cacheable')

// ── CacheProvider Interface ─────────────────────────────────────────────

/**
 * Abstract cache backend. Implement this interface to use Redis, Memcached,
 * or any other cache store with @Cacheable and @CacheEvict.
 *
 * @example
 * ```ts
 * class RedisCacheProvider implements CacheProvider {
 *   private client: RedisClient
 *   constructor(client: RedisClient) { this.client = client }
 *   async get(key: string) {
 *     const val = await this.client.get(key)
 *     return val ? JSON.parse(val) : null
 *   }
 *   async set(key: string, value: any, ttlMs: number) {
 *     await this.client.set(key, JSON.stringify(value), 'PX', ttlMs)
 *   }
 *   async del(key: string) { await this.client.del(key) }
 *   async delByPrefix(prefix: string) {
 *     const keys = await this.client.keys(prefix + '*')
 *     if (keys.length) await this.client.del(...keys)
 *   }
 * }
 * ```
 */
export interface CacheProvider {
  /** Retrieve a cached value. Return null if not found or expired. */
  get(key: string): Promise<any | null>
  /** Store a value with a TTL in milliseconds. */
  set(key: string, value: any, ttlMs: number): Promise<void>
  /** Delete a specific cache key. */
  del(key: string): Promise<void>
  /** Delete all keys matching a prefix. Used by @CacheEvict. */
  delByPrefix?(prefix: string): Promise<void>
  /** Optional cleanup on shutdown. */
  shutdown?(): Promise<void>
}

// ── Built-in Memory Provider ────────────────────────────────────────────

/**
 * Default in-memory cache provider using a Map.
 * Suitable for development and single-instance deployments.
 * For multi-instance or production, use a Redis-backed provider.
 */
export class MemoryCacheProvider implements CacheProvider {
  private store = new Map<string, { data: any; expiresAt: number }>()

  async get(key: string): Promise<any | null> {
    const entry = this.store.get(key)
    if (!entry) return null
    if (entry.expiresAt <= Date.now()) {
      this.store.delete(key)
      return null
    }
    return entry.data
  }

  async set(key: string, value: any, ttlMs: number): Promise<void> {
    this.store.set(key, { data: value, expiresAt: Date.now() + ttlMs })
  }

  async del(key: string): Promise<void> {
    this.store.delete(key)
  }

  async delByPrefix(prefix: string): Promise<void> {
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) {
        this.store.delete(key)
      }
    }
  }

  async shutdown(): Promise<void> {
    this.store.clear()
  }
}

// ── Global Cache Registry ───────────────────────────────────────────────

let _cacheProvider: CacheProvider = new MemoryCacheProvider()

/**
 * Set the global cache provider used by @Cacheable and @CacheEvict.
 * Call this before bootstrapping your app.
 *
 * @example
 * ```ts
 * import { setCacheProvider } from '@forinda/kickjs-core'
 * import { RedisCacheProvider } from './redis-cache'
 *
 * setCacheProvider(new RedisCacheProvider(redisClient))
 * ```
 */
export function setCacheProvider(provider: CacheProvider): void {
  _cacheProvider = provider
}

/** Get the current cache provider */
export function getCacheProvider(): CacheProvider {
  return _cacheProvider
}

// ── Cache Options ───────────────────────────────────────────────────────

export interface CacheOptions {
  /** Time-to-live in seconds (default: 60) */
  ttl?: number
  /** Cache key prefix (default: ClassName.methodName) */
  key?: string
}

// ── @Cacheable Decorator ────────────────────────────────────────────────

/**
 * Cache the return value of a method for the specified TTL.
 * Uses the globally registered CacheProvider (default: MemoryCacheProvider).
 *
 * Call `setCacheProvider()` to use Redis or any custom backend.
 *
 * @param ttl - Time-to-live in seconds (default: 60)
 * @param options.key - Custom cache key prefix
 */
export function Cacheable(ttl?: number, options?: { key?: string }): MethodDecorator {
  return (_target, propertyKey, descriptor: PropertyDescriptor) => {
    const original = descriptor.value
    const cacheTtl = (ttl ?? 60) * 1000
    const keyPrefix = options?.key ?? String(propertyKey)

    descriptor.value = async function (...args: any[]) {
      const cacheKey = `${keyPrefix}:${JSON.stringify(args)}`
      const provider = getCacheProvider()

      const cached = await provider.get(cacheKey)
      if (cached !== null) {
        return cached
      }

      const result = await original.apply(this, args)
      await provider.set(cacheKey, result, cacheTtl)
      return result
    }

    return descriptor
  }
}

// ── @CacheEvict Decorator ───────────────────────────────────────────────

/**
 * Evict cached values matching a key prefix after the method executes.
 * Works with any CacheProvider that implements `delByPrefix`.
 *
 * @param key - Cache key prefix to evict (matches the @Cacheable key)
 */
export function CacheEvict(key: string): MethodDecorator {
  return (_target, _propertyKey, descriptor: PropertyDescriptor) => {
    const original = descriptor.value

    descriptor.value = async function (...args: any[]) {
      const result = await original.apply(this, args)
      const provider = getCacheProvider()
      if (provider.delByPrefix) {
        await provider.delByPrefix(key)
      }
      return result
    }

    return descriptor
  }
}

export { CACHEABLE_META }
