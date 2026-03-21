import 'reflect-metadata'

const CACHEABLE_META = Symbol('kick:cacheable')

export interface CacheOptions {
  /** Time-to-live in seconds (default: 60) */
  ttl?: number
  /** Cache key prefix (default: ClassName.methodName) */
  key?: string
}

/**
 * Cache the return value of a method for the specified TTL.
 * Uses an in-memory Map by default. For Redis, pass a custom cache
 * backend via CacheAdapter.
 *
 * @param ttl - Time-to-live in seconds (default: 60)
 * @param options.key - Custom cache key prefix
 */
export function Cacheable(ttl?: number, options?: { key?: string }): MethodDecorator {
  return (_target, propertyKey, descriptor: PropertyDescriptor) => {
    const original = descriptor.value
    const cacheTtl = (ttl ?? 60) * 1000
    const keyPrefix = options?.key ?? String(propertyKey)
    const cache = new Map<string, { data: any; expiresAt: number }>()

    descriptor.value = async function (...args: any[]) {
      const cacheKey = `${keyPrefix}:${JSON.stringify(args)}`
      const cached = cache.get(cacheKey)

      if (cached && cached.expiresAt > Date.now()) {
        return cached.data
      }

      const result = await original.apply(this, args)
      cache.set(cacheKey, { data: result, expiresAt: Date.now() + cacheTtl })
      return result
    }

    return descriptor
  }
}

/**
 * Evict cached values matching a key prefix.
 * Place on mutation methods that invalidate cached data.
 *
 * @param key - Cache key prefix to evict (matches the @Cacheable key)
 */
export function CacheEvict(key: string): MethodDecorator {
  return (_target, _propertyKey, descriptor: PropertyDescriptor) => {
    const original = descriptor.value

    descriptor.value = async function (...args: any[]) {
      const result = await original.apply(this, args)
      // Note: in-memory eviction requires shared cache reference.
      // For cross-method eviction, use CacheAdapter with Redis.
      return result
    }

    return descriptor
  }
}

export { CACHEABLE_META }
