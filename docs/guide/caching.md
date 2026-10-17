# Caching

KickJS provides `@Cacheable` and `@CacheEvict` decorators, and `@CacheResponse` for whole route responses, with a pluggable cache backend. By default, an in-memory `Map` is used. Swap in Redis, Memcached, or any custom store by implementing the `CacheProvider` interface.

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

- **prefix** defaults to `{method}:{ClassName}` (for example `findAll:UserService`), or is exactly `options.key` when you set one
- **args** are the method arguments, serialized to JSON

This means `findById('abc')` and `findById('xyz')` get separate cache entries, and `UserService.findAll()` and `PostService.findAll()` don't share one. The method name stays first, so `@CacheEvict('findAll')` still clears default-keyed `findAll` entries — for every class that has one. An explicit `options.key` is used as given, so two classes that set the same key share entries on purpose.

Simultaneous misses on the same key share one call: if ten requests miss `findAll:UserService:[]` at once, the method runs once and all ten get its result. A failed call isn't cached, so the next one retries.

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

## Caching Whole Responses

`@Cacheable` caches what a service method returns. `@CacheResponse` caches what a route sends, so the handler doesn't run again until the entry expires:

```ts
import { CacheResponse, Controller, Get, type RequestContext } from '@forinda/kickjs'

@Controller()
export class ProductController {
  @CacheResponse({ maxAge: 60, swr: 300 })
  @Get('/')
  async list(ctx: RequestContext) {
    ctx.json(await this.products.list(ctx.query))
  }
}
```

- **What's stored:** a `GET` (or `HEAD`) answered with `200`: the body and its content type, whether the handler called `ctx.json` / `ctx.send` / `ctx.html` or returned a value. Other statuses, and responses that set a cookie, are sent but not stored. The entry lives in your `CacheProvider`, so with Redis every instance shares it.
- **Key:** the route and the URL, query string included.
- **ETag:** a cached response carries one. A client that sends it back in `If-None-Match` gets `304` with no body.
- **`maxAge`:** seconds the entry is served as fresh.
- **`swr`:** seconds past `maxAge` the stale entry is still served, while one request rebuilds it in the background with [`waitUntil`](./serverless.md#work-that-outlives-the-response-waituntil). Without it, the first request after `maxAge` waits for a new one.
- **Concurrent misses** on one key share a single run of the handler.

### Responses that differ per caller

A request with an `Authorization` header or a cookie skips the cache: under one key, one user's response would reach another. To cache per user, list the header in `varies`, and its value becomes part of the key:

```ts
@CacheResponse({ maxAge: 30, varies: ['authorization'] })
@Get('/me/feed')
feed(ctx: RequestContext) { … }
```

`varies` works for any header that selects a different response, such as `accept-language`.

The cache lives on the server; no `Cache-Control` header is sent. Set one yourself if a CDN or the browser should cache the response too.

A cached route can't stream (`ctx.res.write`) or render a template; those throw an error that says so.

## Conditional Requests (ETag / 304)

`@Cacheable` saves your server the work; conditional requests save the transfer. When a client already holds the current version, answer `304 Not Modified` with no body — and skip loading the data at all:

```ts
@Get('/:id')
async show(ctx: RequestContext) {
  const { version, updatedAt } = await this.posts.meta(ctx.params.id) // cheap
  if (ctx.conditional({ etag: `v${version}`, lastModified: updatedAt })) return
  ctx.json(await this.posts.full(ctx.params.id)) // only when the client's copy is stale
}
```

`ctx.conditional({ etag, lastModified })` sets `ETag` and `Last-Modified`, compares them with the request's `If-None-Match` / `If-Modified-Since`, and answers `304` when nothing changed. It returns `true` when it answered. A bare tag is quoted for you (`'v2'` → `"v2"`); prefix `W/` for a weak one.

The same call protects writes from lost updates. A client that sends `If-Match: "v2"` with its `PUT` gets `412 Precondition Failed` if someone else changed the resource first:

```ts
@Put('/:id')
async update(ctx: RequestContext) {
  const { version } = await this.posts.meta(ctx.params.id)
  if (ctx.conditional({ etag: `v${version}` })) return // 412 when stale
  ctx.json(await this.posts.update(ctx.params.id, ctx.body))
}
```

Preconditions are evaluated in RFC 9110 order (`If-Match`, `If-Unmodified-Since`, `If-None-Match`, `If-Modified-Since`) on every runtime. `evaluatePreconditions(method, headers, validators)` exposes the decision on its own.

## API Reference

### `@Cacheable(ttl?, options?)`

| Param         | Type     | Default                | Description                 |
| ------------- | -------- | ---------------------- | --------------------------- |
| `ttl`         | `number` | `60`                   | Time-to-live in **seconds** |
| `options.key` | `string` | `{method}:{ClassName}` | Cache key prefix            |

### `@CacheResponse(options)`

| Option   | Type       | Default             | Description                                                                               |
| -------- | ---------- | ------------------- | ----------------------------------------------------------------------------------------- |
| `maxAge` | `number`   | —                   | Seconds a stored response is fresh                                                        |
| `swr`    | `number`   | `0`                 | Seconds past `maxAge` the stale response is served while it's rebuilt in the background   |
| `varies` | `string[]` | `[]`                | Request headers whose values are part of the key; `authorization` / `cookie` opt those in |
| `key`    | `string`   | `Controller.method` | Key prefix                                                                                |

### `@CacheEvict(key)`

| Param | Type     | Description               |
| ----- | -------- | ------------------------- |
| `key` | `string` | Cache key prefix to evict |

### `setCacheProvider(provider)`

Set the global cache provider. Call before `bootstrap()`.

### `getCacheProvider()`

Returns the currently active `CacheProvider` instance.

### `MemoryCacheProvider`

Built-in provider using an in-memory `Map`. This is the default.
