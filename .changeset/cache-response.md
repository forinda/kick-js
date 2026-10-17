---
'@forinda/kickjs': minor
---

`@CacheResponse({ maxAge, swr?, varies?, key? })` caches a route's whole response in your `CacheProvider`. A `GET` answered with `200` is stored, whether the handler sent it with `ctx.json` / `ctx.send` / `ctx.html` or returned it. It carries a weak ETag, so a matching `If-None-Match` gets `304`. With `swr`, a stale entry is still served while one request rebuilds it in the background, and concurrent misses share one run of the handler.

The key is the route, host and URL, plus the headers in `varies`. A request that identifies its caller (`Authorization`, `Proxy-Authorization`, `X-Api-Key`, a cookie, or `ctx.user`) skips the cache unless the route varies on it. `key` can be a string prefix, which `@CacheEvict(prefix)` clears, or a function of the context that returns the key, or `null` to skip.

`@Cacheable` and `@CacheEvict` take a function of the method's arguments as their key too, e.g. `@CacheEvict((id) => `product:${id}`)`. `@Cacheable(0)` stores nothing instead of writing an entry that expires at once (Redis rejects `PX 0`). `@CacheEvict` warns once when the provider has no `delByPrefix`.
