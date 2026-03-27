import 'reflect-metadata';
const CACHEABLE_META = Symbol('kick:cacheable');
// ── Built-in Memory Provider ────────────────────────────────────────────
/**
 * Default in-memory cache provider using a Map.
 * Suitable for development and single-instance deployments.
 * For multi-instance or production, use a Redis-backed provider.
 */
export class MemoryCacheProvider {
    store = new Map();
    async get(key) {
        const entry = this.store.get(key);
        if (!entry)
            return null;
        if (entry.expiresAt <= Date.now()) {
            this.store.delete(key);
            return null;
        }
        return entry.data;
    }
    async set(key, value, ttlMs) {
        this.store.set(key, { data: value, expiresAt: Date.now() + ttlMs });
    }
    async del(key) {
        this.store.delete(key);
    }
    async delByPrefix(prefix) {
        for (const key of this.store.keys()) {
            if (key.startsWith(prefix)) {
                this.store.delete(key);
            }
        }
    }
    async shutdown() {
        this.store.clear();
    }
}
// ── Global Cache Registry ───────────────────────────────────────────────
let _cacheProvider = new MemoryCacheProvider();
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
export function setCacheProvider(provider) {
    _cacheProvider = provider;
}
/** Get the current cache provider */
export function getCacheProvider() {
    return _cacheProvider;
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
export function Cacheable(ttl, options) {
    return (_target, propertyKey, descriptor) => {
        const original = descriptor.value;
        const cacheTtl = (ttl ?? 60) * 1000;
        const keyPrefix = options?.key ?? String(propertyKey);
        descriptor.value = async function (...args) {
            const cacheKey = `${keyPrefix}:${JSON.stringify(args)}`;
            const provider = getCacheProvider();
            const cached = await provider.get(cacheKey);
            if (cached !== null) {
                return cached;
            }
            const result = await original.apply(this, args);
            await provider.set(cacheKey, result, cacheTtl);
            return result;
        };
        return descriptor;
    };
}
// ── @CacheEvict Decorator ───────────────────────────────────────────────
/**
 * Evict cached values matching a key prefix after the method executes.
 * Works with any CacheProvider that implements `delByPrefix`.
 *
 * @param key - Cache key prefix to evict (matches the @Cacheable key)
 */
export function CacheEvict(key) {
    return (_target, _propertyKey, descriptor) => {
        const original = descriptor.value;
        descriptor.value = async function (...args) {
            const result = await original.apply(this, args);
            const provider = getCacheProvider();
            if (provider.delByPrefix) {
                await provider.delByPrefix(key);
            }
            return result;
        };
        return descriptor;
    };
}
export { CACHEABLE_META };
//# sourceMappingURL=cache.js.map