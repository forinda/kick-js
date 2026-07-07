---
'@forinda/kickjs': minor
---

Edge-ready rate limiting and sessions:

- `rateLimitGuard()` — ctx-style rate limiter that runs on every runtime AND the `@forinda/kickjs/web` fetch entry (the connect-style `rateLimit()` stays node-only). Sends `X-RateLimit-*` / `Retry-After` headers, pluggable key generator (`cf-connecting-ip` → `x-forwarded-for` → `x-real-ip` by default).
- `KvRateLimitStore` / `KvSessionStore` over a minimal `KvLike` interface — structurally a Cloudflare Workers `KVNamespace` binding, so `new KvRateLimitStore(env.MY_KV, { windowMs })` just works. `KvSessionStore` plugs into the existing node `session()` middleware.
- `createWebApp({ middleware })` — global `(ctx, next)` middlewares on the web entry, the counterpart of `bootstrap({ middleware })`.
- `ctx.setHeader(name, value)` — runtime-neutral response header setter on `RequestContext`.

All new modules are zero-runtime-import and part of the edge purity graph.
