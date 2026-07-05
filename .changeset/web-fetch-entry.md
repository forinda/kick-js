---
'@forinda/kickjs': minor
---

feat: `@forinda/kickjs/web` — web-standard fetch entry for edge runtimes, Bun and Deno

`createWebApp({ h3, modules })` builds a KickJS app as a pure
`fetch(Request) → Promise<Response>` handler — no node http server, no
Application/bootstrap in the bundle graph. Same modules, DI, decorators and
contributor pipeline as `bootstrap()`.

```ts
// Cloudflare Workers (compatibility_flags = ["nodejs_compat"])
import { createWebApp } from '@forinda/kickjs/web'
import * as h3 from 'h3' // v2
const app = createWebApp({ h3, modules })
export default { fetch: (req) => app.fetch(req) }
```

- `createFetchHandler((env) => options)` — Workers convenience that seeds
  ConfigService/@Value from the `env` binding on first request
- Bundle purity enforced by test: the built `dist/web.mjs` graph contains no
  `express` and no `node:*` imports besides `node:async_hooks` (ALS)
- Internal: container's `@Asset` resolution now goes through a resolver slot
  so the asset manager's `node:fs` never enters the edge graph; the pure
  upload core moved to `upload-config.ts` (public API unchanged)
