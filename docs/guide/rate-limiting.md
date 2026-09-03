# Rate Limiting

KickJS includes a built-in rate limiting middleware that protects your API from abuse. It uses an in-memory store by default and supports pluggable stores for distributed deployments.

## Basic Usage

```ts
import { rateLimit } from '@forinda/kickjs'

bootstrap({
  modules,
  middlewares: [rateLimit({ max: 100, windowMs: 60_000 })],
})
```

This limits each client to **100 requests per minute** based on their IP address.

## Options

| Option         | Type               | Default               | Description                                |
| -------------- | ------------------ | --------------------- | ------------------------------------------ |
| `max`          | `number`           | `100`                 | Maximum requests per window                |
| `windowMs`     | `number`           | `60_000`              | Window size in milliseconds                |
| `message`      | `string`           | `'Too Many Requests'` | Response message on limit exceeded         |
| `statusCode`   | `number`           | `429`                 | HTTP status code on limit exceeded         |
| `keyGenerator` | `(req) => string`  | `req.ip`              | Function to derive the rate limit key      |
| `headers`      | `boolean`          | `true`                | Send `RateLimit-*` response headers        |
| `store`        | `RateLimitStore`   | In-memory             | Custom store for distributed rate limiting |
| `skip`         | `(req) => boolean` | —                     | Skip rate limiting for certain requests    |
| `skipPaths`    | `string[]`         | `[]`                  | Paths to exclude from rate limiting        |

## Response Headers

When `headers` is enabled (default), the middleware sets:

- `RateLimit-Limit` — maximum allowed requests
- `RateLimit-Remaining` — remaining requests in the current window
- `RateLimit-Reset` — Unix timestamp when the window resets

## Per-Route Rate Limiting

Apply different limits to specific routes using the `@Middleware` decorator:

```ts
import { rateLimit } from '@forinda/kickjs'

@Controller()
class AuthController {
  @Post('/login')
  @Middleware(rateLimit({ max: 5, windowMs: 15 * 60_000 }))
  async login(ctx: RequestContext) {
    // 5 attempts per 15 minutes
  }
}
```

## Skip Paths

Exclude health checks or public endpoints:

```ts
rateLimit({
  max: 100,
  skipPaths: ['/health', '/metrics'],
})
```

## Custom Key Generator

Rate limit by API key instead of IP:

```ts
rateLimit({
  keyGenerator: (req) => (req.headers['x-api-key'] as string) ?? req.ip ?? '127.0.0.1',
})
```

## Custom Store (Redis)

Implement the `RateLimitStore` interface for distributed deployments:

```ts
import type { RateLimitStore } from '@forinda/kickjs'

class RedisStore implements RateLimitStore {
  constructor(
    private redis: Redis,
    private windowMs: number,
  ) {}

  async increment(key: string) {
    const hits = await this.redis.incr(`rl:${key}`)
    if (hits === 1) await this.redis.pexpire(`rl:${key}`, this.windowMs)
    const ttl = await this.redis.pttl(`rl:${key}`)
    return { totalHits: hits, resetTime: new Date(Date.now() + ttl) }
  }

  async decrement(key: string) {
    await this.redis.decr(`rl:${key}`)
  }

  async reset(key: string) {
    await this.redis.del(`rl:${key}`)
  }
}

rateLimit({ store: new RedisStore(redis, 60_000) })
```

## Exempting routes by flag

`rateLimitGuard()` accepts `exemptWhen`, so "this endpoint is not limited" is
declared on the route rather than restated as a path here:

```ts
import { defineRouteFlag, rateLimitGuard, Middleware } from '@forinda/kickjs'

const Public = defineRouteFlag('auth.public')

@Middleware(rateLimitGuard({ max: 60, exemptWhen: 'auth.public' }))
@Controller()
export class ApiController {
  @Public
  @Get('/health') // never limited
  health(ctx: RequestContext) {}

  @Get('/search') // limited
  search(ctx: RequestContext) {}
}
```

It takes a flag name, a list (any-of), or a predicate — including one that reads
a flag's value:

```ts
rateLimitGuard({ max: 60, exemptWhen: ['auth.public', 'health.probe'] })
rateLimitGuard({
  max: 60,
  exemptWhen: ({ flags }) => (flags.get('rate.limit') as { rpm: number })?.rpm === 0,
})
```

### The app-wide limiter reads flags too

`rateLimit()` runs before route matching, so there is no `ctx.route` for it to read. It gets the
flags a different way: every mounted route registers its method, path and flags in a table at
boot, and the limiter looks the incoming request up against it.

```ts
bootstrap({
  modules,
  middlewares: [rateLimit({ max: 60, exemptWhen: 'auth.public' })],
})
```

That covers what `skipPaths` could not — a flagged route with a param is exempt by declaration:

```ts
@Public
@Get('/probe/:name') // exempt for every :name
probe(ctx: RequestContext) {}
```

**A request matching no route matches no flags, and stays limited.** That is the reason to keep
this middleware pre-match rather than replacing it with a guard: an abuse control has to see
traffic that hits nothing, and a route-scoped guard never does.

Keep `skipPaths` for paths that are not routes at all — a static mount, a proxied prefix. A flag
cannot describe those, because there is no handler to put it on.
