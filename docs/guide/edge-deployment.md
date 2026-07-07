# Edge Deployment (Workers / Bun / Deno)

KickJS apps can run as a **web-standard `fetch(Request) → Response` handler** —
no node http server, no `bootstrap()`. Same modules, controllers, DI, and
context decorators; the entry file is the only thing that changes.

Two pieces make this work:

- **`@forinda/kickjs/web`** — `createWebApp()` builds your app as a pure fetch
  handler for edge runtimes (Cloudflare Workers), Bun, and Deno.
- **`@forinda/kickjs/h3-web`** — the same web-standard engine (h3 v2) behind
  the classic `bootstrap()` for node servers, so local dev and edge share one
  request pipeline.

Both need **h3 v2** (the web-standards line — `npm i h3@latest`). The
[v1 h3 runtime](./http-runtimes.md#h3) is unaffected and keeps working.

## The fetch entry

```ts
// app.ts — shared by every target
import { createWebApp } from '@forinda/kickjs/web'
import * as h3 from 'h3' // v2
import { modules } from './modules'

export const app = createWebApp({ h3, modules })
```

`createWebApp` accepts the same module shapes as `bootstrap({ modules })`, plus
`apiPrefix` (default `/api`), `defaultVersion` (default `1`),
`contributors` (global context contributors), and `env` (see
[Environment](#environment--config)).

The h3 module is **passed in by you** rather than imported internally — edge
bundlers have no `createRequire`, and this keeps the peer optional for everyone
not using the subpath.

## Cloudflare Workers

```toml
# wrangler.toml
name = "my-kick-app"
main = "src/worker.ts"
compatibility_date = "2026-01-01"
compatibility_flags = ["nodejs_compat"]   # required — AsyncLocalStorage
```

```ts
// src/worker.ts
import { createFetchHandler } from '@forinda/kickjs/web'
import * as h3 from 'h3'
import { modules } from './modules'

export default createFetchHandler((env) => ({ h3, modules, env }))
```

`createFetchHandler` builds the app lazily on the **first request** so the
Workers `env` binding can seed configuration before any module resolves —
Workers have no ambient `process.env`.

The `nodejs_compat` flag is required: request-scoped DI and `ctx.set`/`ctx.get`
ride on `AsyncLocalStorage`.

## Bun

Bun runs node APIs natively, so both entries work:

```ts
// Web-standard (recommended — same code as Workers/Deno)
Bun.serve({ port: 3000, fetch: (req) => app.fetch(req) })
```

```ts
// Or classic bootstrap on the h3 v2 engine
import { bootstrap } from '@forinda/kickjs'
import { h3WebRuntime } from '@forinda/kickjs/h3-web'

await bootstrap({ modules, runtime: h3WebRuntime() })
```

## Deno

```ts
Deno.serve({ port: 3000 }, (req) => app.fetch(req))
```

## Environment & config

On node/Bun/Deno, `process.env` + [`loadEnv()`](./configuration.md) work as
usual. On Workers, pass the `env` binding through `createFetchHandler` (above)
or `createWebApp({ env })` — `ConfigService.get()` and `@Value()` resolve from
it.

## What's different on the edge

| Concern                                            | Status                                                                                                                           |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Routing, DI, decorators, validation, `ctx.problem` | ✅ identical                                                                                                                     |
| Context decorators / request-scoped DI             | ✅ (needs `nodejs_compat` on Workers)                                                                                            |
| SSE (`ctx.sse`)                                    | ✅ — streams over a web `Response`                                                                                               |
| File uploads (`@FileUpload`)                       | ✅ — web `FormData`, buffered in memory                                                                                          |
| `@PreDestroy` request teardown                     | ✅ — runs when the response closes                                                                                               |
| `ctx.render()` / view engines / SPA / static files | ❌ throws — serve assets from the platform CDN                                                                                   |
| Rate limiting                                      | ✅ — `rateLimitGuard()` + `KvRateLimitStore` over a Workers KV binding (below)                                                   |
| Sessions                                           | ⚠️ — `KvSessionStore` plugs into the node `session()` middleware; the cookie middleware itself is not wired on the web entry yet |
| `@Asset` injection                                 | ❌ — reads the filesystem; clear error on access                                                                                 |
| Adapters / plugins                                 | Not wired on the web entry at launch — use `bootstrap()` on node for those                                                       |

## Rate limiting on the edge

In-memory counters die with the isolate, so the edge story is a `(ctx, next)`
guard plus a KV-backed store. `KvLike` is structurally a Cloudflare
`KVNamespace` — pass the binding straight in:

```ts
import { createWebApp, rateLimitGuard, KvRateLimitStore } from '@forinda/kickjs/web'

export default {
  fetch(req: Request, env: Env) {
    const app = createWebApp({
      h3,
      modules,
      env,
      middleware: [
        rateLimitGuard({
          max: 60,
          windowMs: 60_000,
          store: new KvRateLimitStore(env.RATE_KV, { windowMs: 60_000 }),
        }),
      ],
    })
    return app.fetch(req)
  },
}
```

`createWebApp({ middleware })` runs ctx-style middlewares on every route —
the web-entry counterpart of `bootstrap({ middleware })`. `rateLimitGuard`
also works per-route on any runtime via `@Middleware(rateLimitGuard({ max: 10 }))`,
and without a `store` it falls back to a per-process in-memory counter
(fine on node, pointless on edge).

Two caveats: KV is eventually consistent, so limiting is **approximate**
under concurrent bursts (use a Durable Object or Redis store for exact
quotas), and Cloudflare KV enforces a minimum 60-second TTL (shorter
windows still limit correctly; the KV entry just lives a bit longer).

Sessions: `KvSessionStore` implements the `SessionStore` contract for the
node `session()` middleware — `new KvSessionStore(kv)` makes sessions
survive restarts and horizontal scaling today. The cookie-handling
middleware itself is not wired on the web entry yet.

### Runtime support (AsyncLocalStorage)

| Runtime                | Supported | Notes                                                                            |
| ---------------------- | --------- | -------------------------------------------------------------------------------- |
| Cloudflare Workers     | ✅        | `compatibility_flags = ["nodejs_compat"]`                                        |
| Deno / Deno Deploy     | ✅        | built-in node compat                                                             |
| Bun                    | ✅        | native                                                                           |
| Vercel (Node runtime)  | ✅        | use their Node functions — Vercel recommends Node over their legacy Edge runtime |
| Netlify Edge Functions | ❌        | no AsyncLocalStorage — use Netlify's regular (Node) Functions instead            |

## One pipeline, two entries

`createWebApp` and `h3WebRuntime()` share the same request pipeline (the web
driver pair), so behavior is identical between `bootstrap()` on your dev
machine and the deployed fetch handler. The package also enforces a **bundle
purity contract** in CI: the built `@forinda/kickjs/web` graph contains no
`express` and no `node:*` import besides `node:async_hooks`.
