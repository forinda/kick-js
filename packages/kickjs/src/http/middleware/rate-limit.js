class MemoryStore {
    windowMs;
    hits = new Map();
    cleanupTimer;
    constructor(windowMs) {
        this.windowMs = windowMs;
        this.cleanupTimer = setInterval(() => this.cleanup(), windowMs);
        // Allow the process to exit without waiting for the timer
        if (this.cleanupTimer.unref) {
            this.cleanupTimer.unref();
        }
    }
    async increment(key) {
        const now = Date.now();
        const entry = this.hits.get(key);
        if (entry && entry.resetTime.getTime() > now) {
            entry.totalHits++;
            return { totalHits: entry.totalHits, resetTime: entry.resetTime };
        }
        const resetTime = new Date(now + this.windowMs);
        const newEntry = { totalHits: 1, resetTime };
        this.hits.set(key, newEntry);
        return { totalHits: 1, resetTime };
    }
    async decrement(key) {
        const entry = this.hits.get(key);
        if (entry && entry.totalHits > 0) {
            entry.totalHits--;
        }
    }
    async reset(key) {
        this.hits.delete(key);
    }
    cleanup() {
        const now = Date.now();
        for (const [key, entry] of this.hits) {
            if (entry.resetTime.getTime() <= now) {
                this.hits.delete(key);
            }
        }
    }
}
/**
 * Rate limiting middleware.
 *
 * Limits the number of requests a client can make within a time window.
 * Uses an in-memory store by default, but accepts a custom store for
 * distributed deployments (e.g. Redis).
 *
 * @example
 * ```ts
 * import { rateLimit } from '@forinda/kickjs-http'
 *
 * bootstrap({
 *   modules,
 *   middleware: [
 *     rateLimit({ max: 100, windowMs: 60_000 }),
 *     // ... other middleware
 *   ],
 * })
 * ```
 */
export function rateLimit(options = {}) {
    const max = options.max ?? 100;
    const windowMs = options.windowMs ?? 60_000;
    const message = options.message ?? 'Too Many Requests';
    const statusCode = options.statusCode ?? 429;
    const keyGenerator = options.keyGenerator ?? ((req) => req.ip ?? '127.0.0.1');
    const sendHeaders = options.headers ?? true;
    const store = options.store ?? new MemoryStore(windowMs);
    const skip = options.skip;
    const skipPaths = new Set(options.skipPaths ?? []);
    return async (req, res, next) => {
        // Skip if path is in the skip list
        if (skipPaths.has(req.path)) {
            return next();
        }
        // Skip if the skip function returns true
        if (skip && skip(req)) {
            return next();
        }
        const key = keyGenerator(req);
        const { totalHits, resetTime } = await store.increment(key);
        const remaining = Math.max(0, max - totalHits);
        if (sendHeaders) {
            res.setHeader('RateLimit-Limit', max);
            res.setHeader('RateLimit-Remaining', remaining);
            res.setHeader('RateLimit-Reset', Math.ceil(resetTime.getTime() / 1000));
        }
        if (totalHits > max) {
            return res.status(statusCode).json({ message });
        }
        next();
    };
}
//# sourceMappingURL=rate-limit.js.map