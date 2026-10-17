---
'@forinda/kickjs': minor
---

`@CacheResponse({ maxAge, swr?, varies? })` caches a route's whole response in your `CacheProvider`. A `GET` answered with `200` is stored, whether the handler sent it with `ctx.json` / `ctx.send` / `ctx.html` or returned it. It carries a weak ETag, so a matching `If-None-Match` gets `304`. With `swr`, a stale entry is still served while one request rebuilds it in the background, and concurrent misses share one run of the handler. A request with `Authorization` or a cookie skips the cache unless the route lists that header in `varies`, which makes it part of the key. See the Caching guide.
