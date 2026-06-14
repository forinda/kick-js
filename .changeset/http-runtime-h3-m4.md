---
'@forinda/kickjs': minor
---

Add the **h3 runtime** — `@forinda/kickjs/h3` (M4). h3 is the HTTP layer behind Nitro / Nuxt; KickJS now runs on it with no controller or module changes:

```ts
import { h3Runtime } from '@forinda/kickjs/h3'
export const app = await bootstrap({ modules, runtime: h3Runtime() })
```

`h3Runtime()` implements the full `HttpRuntime` contract over **h3 v1** (the stable, node-based surface — `createApp` / `createRouter` / `toNodeListener`, with `event.node.req` / `event.node.res`). Routes become native h3 router routes; the node response is wrapped in a `RuntimeResponse` so `ctx.json` / `ctx.html` / `ctx.sse` work unchanged; connect middleware runs via h3's `fromNodeMiddleware`; bodies parse natively (`readBody`).

`h3` is an **optional peer** (`^1`); the root package never loads it unless this subpath is used. The conformance suite now runs the same fixture app under **Express, Fastify, and h3** (24 cases) — routing, the response driver, connect middleware, context decorators, errors / 404, SSE, and validation all pass on all three.

h3 v2's web-standard `Request` / `Response` core is the eventual target via a future web-standard driver (spec §8); until then this binding uses the node-compatible v1 surface. File uploads remain gated (`capability: false`) on Fastify and h3.
