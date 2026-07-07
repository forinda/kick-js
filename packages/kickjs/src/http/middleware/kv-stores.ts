// Edge-safe store adapters over a minimal KV surface. Zero runtime imports —
// this file must stay importable from the `@forinda/kickjs/web` purity graph.
import type { RateLimitStore } from './rate-limit'
import type { SessionData, SessionStore } from './session'

/**
 * The minimal async KV surface both stores need. Structurally compatible
 * with a Cloudflare Workers `KVNamespace` binding — pass it straight in:
 *
 * ```ts
 * export default {
 *   fetch(req: Request, env: Env) {
 *     const store = new KvRateLimitStore(env.MY_KV, { windowMs: 60_000 })
 *     // ...
 *   },
 * }
 * ```
 *
 * Anything with the same shape works too (Deno KV wrapper, Upstash Redis
 * REST client adapter, a Map-backed fake in tests).
 */
export interface KvLike {
  get(key: string): Promise<string | null>
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>
  delete(key: string): Promise<void>
}

/** Cloudflare KV rejects TTLs under 60 seconds — clamp up, never down. */
function kvTtlSeconds(ms: number): number {
  return Math.max(60, Math.ceil(ms / 1000))
}

export interface KvRateLimitStoreOptions {
  /** Window length in ms — must match the `windowMs` given to the limiter. */
  windowMs: number
  /** Key prefix in the KV namespace (default `'rl:'`). */
  prefix?: string
}

/**
 * {@link RateLimitStore} over a {@link KvLike} namespace, for edge deployments
 * where in-memory counters reset on every isolate.
 *
 * KV is eventually consistent and this is a read-modify-write counter, so
 * limiting is **approximate** under concurrency — bursts racing across
 * isolates can each read the same count. That is the accepted trade-off for
 * abuse throttling; use a Durable Object / Redis store when you need an
 * exact ceiling (billing quotas, strict per-key locks).
 */
export class KvRateLimitStore implements RateLimitStore {
  private readonly prefix: string
  private readonly windowMs: number

  constructor(
    private readonly kv: KvLike,
    options: KvRateLimitStoreOptions,
  ) {
    this.windowMs = options.windowMs
    this.prefix = options.prefix ?? 'rl:'
  }

  async increment(key: string): Promise<{ totalHits: number; resetTime: Date }> {
    const now = Date.now()
    const entry = await this.read(key)
    if (entry && entry.reset > now) {
      entry.hits++
      await this.write(key, entry)
      return { totalHits: entry.hits, resetTime: new Date(entry.reset) }
    }
    const fresh = { hits: 1, reset: now + this.windowMs }
    await this.write(key, fresh)
    return { totalHits: 1, resetTime: new Date(fresh.reset) }
  }

  async decrement(key: string): Promise<void> {
    const entry = await this.read(key)
    if (entry && entry.hits > 0) {
      entry.hits--
      await this.write(key, entry)
    }
  }

  async reset(key: string): Promise<void> {
    await this.kv.delete(this.prefix + key)
  }

  private async read(key: string): Promise<{ hits: number; reset: number } | null> {
    const raw = await this.kv.get(this.prefix + key)
    if (raw === null) return null
    try {
      return JSON.parse(raw) as { hits: number; reset: number }
    } catch {
      return null
    }
  }

  private async write(key: string, entry: { hits: number; reset: number }): Promise<void> {
    await this.kv.put(this.prefix + key, JSON.stringify(entry), {
      expirationTtl: kvTtlSeconds(Math.max(entry.reset - Date.now(), 1000)),
    })
  }
}

export interface KvSessionStoreOptions {
  /** Key prefix in the KV namespace (default `'sess:'`). */
  prefix?: string
}

/**
 * {@link SessionStore} over a {@link KvLike} namespace. Plug into the node
 * `session()` middleware today (e.g. backed by Upstash/Cloudflare KV via
 * REST) so sessions survive restarts and horizontal scaling; TTL expiry is
 * delegated to the KV layer via `expirationTtl`.
 *
 * Cost note: `touch()` is a get + put round-trip (KvLike has no TTL-only
 * refresh), so `session({ rolling: true })` doubles KV operations per
 * request — per-operation-billed platforms may prefer `rolling: false`.
 */
export class KvSessionStore implements SessionStore {
  private readonly prefix: string

  constructor(
    private readonly kv: KvLike,
    options: KvSessionStoreOptions = {},
  ) {
    this.prefix = options.prefix ?? 'sess:'
  }

  async get(sid: string): Promise<SessionData | null> {
    const raw = await this.kv.get(this.prefix + sid)
    if (raw === null) return null
    try {
      return JSON.parse(raw) as SessionData
    } catch {
      return null
    }
  }

  async set(sid: string, data: SessionData, maxAge: number): Promise<void> {
    await this.kv.put(this.prefix + sid, JSON.stringify(data), {
      expirationTtl: kvTtlSeconds(maxAge),
    })
  }

  async destroy(sid: string): Promise<void> {
    await this.kv.delete(this.prefix + sid)
  }

  async touch(sid: string, maxAge: number): Promise<void> {
    const data = await this.get(sid)
    if (data !== null) await this.set(sid, data, maxAge)
  }
}
