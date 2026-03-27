import 'reflect-metadata';
declare const CACHEABLE_META: unique symbol;
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
    get(key: string): Promise<any | null>;
    /** Store a value with a TTL in milliseconds. */
    set(key: string, value: any, ttlMs: number): Promise<void>;
    /** Delete a specific cache key. */
    del(key: string): Promise<void>;
    /** Delete all keys matching a prefix. Used by @CacheEvict. */
    delByPrefix?(prefix: string): Promise<void>;
    /** Optional cleanup on shutdown. */
    shutdown?(): Promise<void>;
}
/**
 * Default in-memory cache provider using a Map.
 * Suitable for development and single-instance deployments.
 * For multi-instance or production, use a Redis-backed provider.
 */
export declare class MemoryCacheProvider implements CacheProvider {
    private store;
    get(key: string): Promise<any | null>;
    set(key: string, value: any, ttlMs: number): Promise<void>;
    del(key: string): Promise<void>;
    delByPrefix(prefix: string): Promise<void>;
    shutdown(): Promise<void>;
}
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
export declare function setCacheProvider(provider: CacheProvider): void;
/** Get the current cache provider */
export declare function getCacheProvider(): CacheProvider;
export interface CacheOptions {
    /** Time-to-live in seconds (default: 60) */
    ttl?: number;
    /** Cache key prefix (default: ClassName.methodName) */
    key?: string;
}
/**
 * Cache the return value of a method for the specified TTL.
 * Uses the globally registered CacheProvider (default: MemoryCacheProvider).
 *
 * Call `setCacheProvider()` to use Redis or any custom backend.
 *
 * @param ttl - Time-to-live in seconds (default: 60)
 * @param options.key - Custom cache key prefix
 */
export declare function Cacheable(ttl?: number, options?: {
    key?: string;
}): MethodDecorator;
/**
 * Evict cached values matching a key prefix after the method executes.
 * Works with any CacheProvider that implements `delByPrefix`.
 *
 * @param key - Cache key prefix to evict (matches the @Cacheable key)
 */
export declare function CacheEvict(key: string): MethodDecorator;
export { CACHEABLE_META };
//# sourceMappingURL=cache.d.ts.map