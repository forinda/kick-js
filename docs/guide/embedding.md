# Embedding in Hono, Nitro and other frameworks

A KickJS app can run inside another framework as one of its handlers: the host
owns the server and its own routes, and hands the requests under a prefix —
`/api/*`, say — to KickJS. Use this to add KickJS modules to an existing Hono or
Nitro app, or to deploy them where that framework runs.

KickJS answers through `fetch(request)`, so any host that can hand over a web
`Request` and send back a `Response` works. There are two ways to get a `fetch`:

|                      | `createWebApp`                                                                        | `Application` on h3                                         |
| -------------------- | ------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Import               | `@forinda/kickjs/web`                                                                 | `@forinda/kickjs`, `@forinda/kickjs/h3`                     |
| Runs on              | Node, Bun, Deno, Cloudflare Workers                                                   | Node                                                        |
| Adapters and plugins | not wired — see [what's different](./edge-deployment.md#what-s-different-on-the-edge) | ✅ (`afterStart` doesn't run: there's no server of its own) |
| Connect middleware   | ❌ — `(ctx, next)` middleware only                                                    | ✅                                                          |

Both answer errors with the same problem details as `bootstrap()`, take file
uploads with no driver to install, and run constructor injection, validation and
context decorators as usual.

```ts
// kick.ts — the web entry
import * as h3 from 'h3' // v2
import { createWebApp } from '@forinda/kickjs/web'
import { modules } from './modules'

export const kick = createWebApp({ h3, modules })
```

```ts
// kick.ts — the full Application, on Node
import { Application } from '@forinda/kickjs'
import { h3Runtime } from '@forinda/kickjs/h3'
import { modules } from './modules'

export const kick = new Application({ modules, adapters, runtime: h3Runtime() })
await kick.startWithoutServer() // no listener: the host has the port
```

Install `h3` v2 for either. The full `Application` on the default runtime would
need `express`; `h3Runtime()` answers `fetch` directly.

## Decorators

The host compiles your TypeScript, so it has to compile KickJS's decorators the
way KickJS expects: TypeScript's legacy decorators, with their metadata. The
metadata is what constructor injection reads — without it a constructor
parameter arrives as `undefined`, with no error.

```json
// tsconfig.json
{
  "compilerOptions": {
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true
  }
}
```

esbuild — and tools built on it, such as `tsx` — compiles the decorators but
never emits the metadata. Each host section below shows the setting that does.

## Hono

Hand KickJS the requests under its prefix:

```ts
import { Hono } from 'hono'
import { kick } from './kick'

const app = new Hono()
app.get('/', (c) => c.text('from hono'))
app.all('/api/*', (c) => kick.fetch(c.req.raw))

export default app
```

`app.mount('/api', kick.fetch)` strips `/api` from the path before KickJS sees
it, so the default `/api` prefix no longer matches. Either mount at `/`, or give
KickJS no prefix of its own:

```ts
app.mount('/api', createWebApp({ h3, modules, apiPrefix: '' }).fetch)
```

**Building:** compile with SWC, which emits decorator metadata — the
`unplugin-swc` setup a KickJS project already uses. On Node, serve it with `@hono/node-server`;
on Workers, Bun or Deno, use `createWebApp` and follow the platform's Hono setup.

## Nitro 3

Nitro 3 runs on h3 v2, the same h3 KickJS uses, and its `event.req` is already
a web `Request`. A catch-all route hands it over:

```ts
// routes/api/[...].ts
import * as h3 from 'h3'
import { defineHandler } from 'nitro/h3'
import { createWebApp } from '@forinda/kickjs/web'
import { modules } from '../../modules'

const kick = createWebApp({ h3, modules })

export default defineHandler((event) => kick.fetch(event.req))
```

Nitro 3 compiles with rolldown, which needs the decorators turned on in its own
config — `tsconfig.json` isn't read for this:

```ts
// nitro.config.ts
import { defineConfig } from 'nitro/config'

export default defineConfig({
  rolldownConfig: {
    transform: { decorator: { legacy: true, emitDecoratorMetadata: true } },
  },
})
```

## Nitro 2

Nitro 2 (`nitropack`) runs on h3 v1. KickJS's web entry needs h3 v2, so install
it under another name beside Nitro's own:

```json
// package.json
{
  "dependencies": {
    "h3": "^1.15.0",
    "h3-v2": "npm:h3@^2.0.0"
  }
}
```

```ts
// routes/api/[...].ts
import { defineEventHandler, toWebRequest } from 'h3'
import * as h3v2 from 'h3-v2'
import { createWebApp } from '@forinda/kickjs/web'
import { modules } from '../../modules'

const kick = createWebApp({ h3: h3v2, modules })

export default defineEventHandler((event) => kick.fetch(toWebRequest(event)))
```

Nitro 2 compiles with esbuild, which emits no decorator metadata. Compile with
SWC instead, ahead of Nitro's own TypeScript step, and set both decorator
options in `tsconfig.json` (above) — SWC reads them from there:

```ts
// nitro.config.ts
import { defineNitroConfig } from 'nitropack/config'
import swc from 'unplugin-swc'

export default defineNitroConfig({
  hooks: {
    'rollup:before'(_nitro, config) {
      ;(config.plugins as unknown[]).unshift(swc.rollup())
    },
  },
})
```

## Other hosts

Any host that hands over a web `Request` and sends back the `Response` should
work the same way — for `Bun.serve` and `Deno.serve`, see
[Edge deployment](./edge-deployment.md). Check two things:

- **The path.** If the host strips its mount prefix, set `apiPrefix: ''`.
- **The decorators.** Whatever compiles your TypeScript must emit legacy
  decorators and their metadata.

To have KickJS drive an engine's own router instead — as it does with Fastify —
see [HTTP runtimes](./http-runtimes.md).
