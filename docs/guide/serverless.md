# Serverless (Netlify / Vercel)

Netlify Functions and Vercel Functions hand your code a request instead of a
port. `createHandler()` builds the app for that: same modules, controllers,
DI, contributors and adapters as `bootstrap()`, served as a handler.

```ts
// server/src/serverless.ts
import 'reflect-metadata'
import './config'
import { createHandler } from '@forinda/kickjs'
import { modules } from './modules'

export const handler = createHandler({ modules })
```

| Method                   | Signature                     | Use it for                                 |
| ------------------------ | ----------------------------- | ------------------------------------------ |
| `handler.fetch(request)` | `Request → Promise<Response>` | Netlify Functions, anything web-standard   |
| `handler.node(req, res)` | Node `(req, res)`             | Vercel Node functions, `http.createServer` |
| `handler.ready()`        | `Promise<Application>`        | Warm the app up before the first request   |
| `handler.close()`        | `Promise<void>`               | Shut adapters down (tests, graceful exit)  |

## Which project layout

`createHandler()` is the same in every KickJS app. The layout decides where the files go and whether the platform also serves a frontend.

|                  | API only (`kick new --template rest` or `minimal`) | Fullstack (`kick new --template fullstack`) |
| ---------------- | -------------------------------------------------- | ------------------------------------------- |
| Serverless entry | `src/serverless.ts`                                | `server/src/serverless.ts`                  |
| Bundle config    | `vite.serverless.config.ts`                        | `server/vite.serverless.config.ts`          |
| Bundle output    | `dist-serverless/server.mjs`                       | `server/dist-serverless/server.mjs`         |
| Static files     | None                                               | `web/dist`, served by the platform          |
| `SpaAdapter`     | Not used                                           | Left out of the serverless entry (below)    |

The examples on this page use the fullstack layout. Each platform section says what changes for an API-only project.

### Fullstack: leave `SpaAdapter` out

The fullstack server's `src/index.ts` registers `SpaAdapter({ clientDir: '../web/dist' })`, so one process serves both the API and the built web app. On Netlify and Vercel the platform serves `web/dist` itself, so the serverless entry passes the modules and any other adapters, without `SpaAdapter`. Keep `src/index.ts` as it is for `kick dev` and `kick start`.

The web app's client calls `/api/v1` on its own origin (`baseUrl: '/api/v1'` in `web/src/api.ts`). That works unchanged when the API and web app deploy as one site, which is what the examples below do. For [two separate deploys](#two-deploys), proxy `/api/*` from the web site to the API site so the client URL still works.

## What differs from `bootstrap()`

- **Setup runs once per function instance**, on the first request, and is reused while the instance stays warm. If setup throws, the next request tries again.
- **Nothing listens on a port**, so adapter `afterStart` hooks do not run. Startup logs a warning naming any adapter that has one — WebSocket adapters and anything else that attaches to the `http.Server` are unavailable.
- **No process signal or error handlers** are registered. The platform owns the process.
- **One handler per process.** The DI container is process-wide.

### How `fetch` works on Express

Express has no `fetch` of its own. `handler.fetch()` starts a server bound to `127.0.0.1` on a random port inside the same process, the first time it is needed, and forwards each `Request` to it:

- request bodies are buffered in memory before the app's body parser sees them. Netlify and Vercel cap request bodies before your function runs; on a host without that cap, limit body size in front of the handler;
- hop-by-hop headers are dropped; `x-forwarded-host` and `x-forwarded-proto` are set to what the platform received;
- response bodies stream back, with every `Set-Cookie` kept.

The forwarded request comes from `127.0.0.1`. If you read the client IP, pass `trustProxy: 'loopback'` so it is taken from the `X-Forwarded-For` header the platform sets:

```ts
export const handler = createHandler({ modules, trustProxy: 'loopback' })
```

With `trustProxy: 'loopback'` the app believes whatever `X-Forwarded-*` headers the `Request` carries. Netlify sets them itself, so that is safe there. Leave it off if `handler.fetch()` can receive requests that did not come through a platform that sets these headers.

A runtime whose app already has `fetch` — the [h3 v2 runtime](./edge-deployment.md) — is called directly, with no forwarding.

## Build one self-contained bundle

Hand the platform **compiled JavaScript**, never the TypeScript source. Netlify bundles TypeScript functions with esbuild, which does not emit `emitDecoratorMetadata` — constructor injection would silently lose its type metadata. Build with the same Vite + SWC setup as `kick build`, and inline every dependency:

```ts
// server/vite.serverless.config.ts
import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'
import swc from 'unplugin-swc'

export default defineConfig({
  oxc: false,
  plugins: [swc.vite()],
  ssr: { noExternal: true, target: 'node' },
  build: {
    ssr: true,
    target: 'node20',
    outDir: 'dist-serverless',
    minify: false,
    rollupOptions: {
      input: fileURLToPath(new URL('./src/serverless.ts', import.meta.url)),
      // Optional peers you don't install must stay external: inlined, a missing
      // one becomes a stub that throws on load.
      external: ['valibot', 'yup'],
      output: { format: 'esm', entryFileNames: 'server.mjs', inlineDynamicImports: true },
    },
  },
})
```

```bash
vite build --config vite.serverless.config.ts   # → dist-serverless/server.mjs
```

## Netlify

The function file has to be **written by the build command** — Netlify clears `.netlify/` before building. A small script run after the bundle build does it:

```js
// .netlify/v1/functions/api.mjs (written during the build)
import { handler } from '../../../server/dist-serverless/server.mjs'

export default (request) => handler.fetch(request)

export const config = {
  path: '/api/*',
  preferStatic: true,
}
```

`config` must be a literal — Netlify reads it without running the file. With `path: '/api/*'` the app sees the original URL, so routes stay under `/api/v1/…`.

For a web app in the same repo, publish its build and let the function take `/api/*`:

```toml
# netlify.toml
[build]
  command = "pnpm build && pnpm --filter ./server exec vite build --config vite.serverless.config.ts && node scripts/write-netlify-function.mjs"
  publish = "web/dist"

[[redirects]]
  from = "/*"
  to = "/index.html"
  status = 200
```

**API only:** import the bundle from `../../../dist-serverless/server.mjs`, build with `vite build --config vite.serverless.config.ts && node scripts/write-netlify-function.mjs`, and drop the SPA redirect. Set `publish` to an empty folder (a `public/` with a `.gitkeep`): without it, Netlify publishes the project's base directory as static files.

## Vercel

Write the [Build Output API](https://vercel.com/docs/build-output-api) tree and deploy it with `vercel deploy --prebuilt`:

```text
.vercel/output/
  config.json              { "version": 3, "routes": [
                               { "handle": "filesystem" },
                               { "src": "^/api/(.*)$", "dest": "/api" },
                               { "src": "^/(.*)$", "dest": "/index.html" } ] }
  static/                  ← web/dist
  functions/api.func/
    server.mjs             ← the bundle (nothing above .func is visible at runtime)
    index.mjs              import { handler } from './server.mjs'
                           export default handler.node
    .vc-config.json        { "runtime": "nodejs22.x", "handler": "index.mjs",
                             "launcherType": "Nodejs", "supportsResponseStreaming": true }
```

The function receives the original path, so routes stay under `/api/v1/…`.

**API only:** skip `static/` and keep only the `/api/(.*)` route in `config.json`.

## Two deploys

A fullstack workspace can also deploy as two projects: the API (API-only setup above, from `server/`) and the web app as a static site (`web/dist`). Keep the client's relative `baseUrl` by proxying `/api/*` from the web site to the API:

```toml
# web site netlify.toml, before the SPA redirect
[[redirects]]
  from = "/api/*"
  to = "https://your-api.netlify.app/api/:splat"
  status = 200
```

```json
// web project vercel.json
{
  "rewrites": [
    { "source": "/api/:path*", "destination": "https://your-api.vercel.app/api/:path*" },
    { "source": "/(.*)", "destination": "/index.html" }
  ]
}
```

Without a proxy, set the client's `baseUrl` to the API's full URL and enable [`cors()`](./middleware.md) on the API for the web site's origin.

## Limits to design around

|               | Netlify Functions             | Vercel (Hobby, Fluid)        |
| ------------- | ----------------------------- | ---------------------------- |
| Max duration  | 60 s (15 min background)      | 300 s                        |
| Request body  | 6 MB                          | 4.5 MB                       |
| Response body | 6 MB buffered, 20 MB streamed | 4.5 MB                       |
| WebSockets    | Not supported                 | Beta; closes at max duration |

In-memory state does not survive between instances: use a hosted database instead of in-memory repositories, and a shared store (Redis, KV) for rate limiting and sessions. Cron and queue adapters need the platform's scheduled or background functions.
