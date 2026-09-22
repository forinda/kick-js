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
| Bundle output    | `dist/serverless/server.mjs`                       | `server/dist/serverless/server.mjs`         |
| Static files     | None                                               | `web/dist`, served by the platform          |
| `SpaAdapter`     | Not used                                           | Left out of the serverless entry (below)    |

The examples on this page use the fullstack layout. Each platform section says what changes for an API-only project.

### Fullstack: leave `SpaAdapter` out

The fullstack server's `src/index.ts` registers `SpaAdapter({ clientDir: '../web/dist' })`, so one process serves both the API and the built web app. On Netlify and Vercel the platform serves `web/dist` itself, so the serverless entry passes the modules and any other adapters, without `SpaAdapter`. Keep `src/index.ts` as it is for `kick dev` and `kick start`.

The web app's client calls `/api/v1` on its own origin (`baseUrl: '/api/v1'` in `web/src/api.ts`). That works unchanged when the API and web app deploy as one site, which is what the examples below do. For [two separate deploys](#two-deploys), proxy `/api/*` from the web site to the API site so the client URL still works.

### Keep both entries: share the options

`src/index.ts` (`bootstrap()`, for `kick dev` / `kick start`) and `src/serverless.ts` (`createHandler()`) both take `ApplicationOptions`. To keep them from drifting apart, move the side-effect imports and the shared options into one file, and have each entry import it and add only what differs:

```ts
// src/options/app-options.ts
// Side effects every entry needs, in order: decorator metadata, then the env schema.
import 'reflect-metadata'
import '../config'
import { expressRuntime, type ApplicationOptions } from '@forinda/kickjs'
import { modules } from '../modules'

export const appOptions: ApplicationOptions = {
  modules,
  runtime: expressRuntime(),
  // middlewares, contributors, adapters every deploy uses...
}
```

```ts
// src/index.ts — long-running server
import { appOptions } from './options/app-options'
import { bootstrap } from '@forinda/kickjs'
import { SpaAdapter } from '@forinda/kickjs/spa'

export const app = await bootstrap({
  ...appOptions,
  adapters: [...(appOptions.adapters ?? []), SpaAdapter({ clientDir: '../web/dist' })],
})
```

```ts
// src/serverless.ts — Netlify / Vercel
import { appOptions } from './options/app-options'
import { createHandler } from '@forinda/kickjs'

export const handler = createHandler(appOptions)
```

Import `app-options` first in each entry, so its side effects run before anything else loads. A new module, middleware or adapter then goes in `app-options.ts` once; the entries keep only their own differences (`SpaAdapter` in the server, `trustProxy` in the handler, and so on). API-only projects use the same split without `SpaAdapter`.

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
import { devtoolsFlagPlugin, devtoolsStripPlugin } from '@forinda/kickjs-vite'

export default defineConfig({
  oxc: false,
  // The devtools plugins do what kickjsVitePlugin does in `kick build`:
  // devtools code stays out of the production bundle.
  plugins: [swc.vite(), devtoolsFlagPlugin(), devtoolsStripPlugin()],
  ssr: { noExternal: true, target: 'node' },
  build: {
    ssr: true,
    target: 'node20',
    outDir: 'dist/serverless',
    minify: false,
    rollupOptions: {
      input: fileURLToPath(new URL('./src/serverless.ts', import.meta.url)),
      // Optional peers you have NOT installed: inlined, a missing one becomes a
      // stub that throws on load. Remove any you install — left external, it
      // stays a bare import the Vercel function can't resolve.
      external: ['valibot', 'yup'],
      output: { format: 'esm', entryFileNames: 'server.mjs', codeSplitting: false },
    },
  },
})
```

```bash
vite build --config vite.serverless.config.ts   # → dist/serverless/server.mjs
```

`dist/` is already git-ignored, so the bundle needs no new ignore entry. Run this build **after** `kick build`: `kick build` empties `dist/`, including `dist/serverless`.

This config is separate from `vite.config.ts`, so changing its entry does not affect `kick build`, which keeps building `src/index.ts`. The build entry is `rollupOptions.input`; the `entry` passed to `kickjsVitePlugin` is only used by the dev server. Do not point `input` at `src/index.ts`: that entry calls `bootstrap()`, which listens on a port and registers signal handlers inside the function.

## Before the platform builds

**Build from the repo root.** In a fullstack workspace that is the folder holding `pnpm-workspace.yaml` and the lockfile, not `server/`. Only an install from there covers `server/` and `web/`, the platform config files (`netlify.toml`, `vercel.json`) live there, and `.netlify/` / `.vercel/` are written there.

| Platform | Setting                           | Value                                       |
| -------- | --------------------------------- | ------------------------------------------- |
| Netlify  | Base directory, Package directory | empty                                       |
| Netlify  | Build command, Publish directory  | from `netlify.toml`                         |
| Vercel   | Root Directory                    | empty (`./`) — not `server`                 |
| Vercel   | Framework Preset                  | Other                                       |
| Vercel   | Build / Output / Install commands | leave default; `vercel.json` sets the build |

Netlify detects the pnpm workspace and may offer `server` or `web` as the site's package. Leave **Package directory** unset: with a package selected, Netlify reads functions from that package's `.netlify/` instead of the root, ignores the function the build wrote, and every `/api/*` request returns the SPA's `index.html`.

**Fullstack: generate the client types first.** `web` builds with `tsc --noEmit && vite build`, and its types include `server/.kickjs/types`, which `kick typegen` writes and `server/.gitignore` excludes. Locally `kick dev` has already written them; a fresh clone on the platform has not, and the web build fails with `Cannot find type definition file for '../server/.kickjs/types/kick__client'`. Run typegen in the root `build` script, so every command below that starts with `pnpm build` gets it:

```json
// package.json (workspace root)
{
  "scripts": {
    "build": "pnpm --filter ./server exec kick typegen && pnpm -r run build"
  }
}
```

## Netlify

The function file has to be **written by the build command** — Netlify clears `.netlify/` before building. Add a small script that the build command runs after the bundle build:

```js
// scripts/write-netlify-function.mjs
import { mkdirSync, writeFileSync } from 'node:fs'

// Relative to .netlify/v1/functions/. API only: '../../../dist/serverless/server.mjs'
const bundle = '../../../server/dist/serverless/server.mjs'

mkdirSync('.netlify/v1/functions', { recursive: true })
writeFileSync(
  '.netlify/v1/functions/api.mjs',
  `import { handler } from '${bundle}'

export default (request) => handler.fetch(request)

export const config = {
  path: '/api/*',
}
`,
)
```

Run it from the project root; it writes `.netlify/v1/functions/api.mjs`.

`config` must be a literal — Netlify reads it without running the file. With `path: '/api/*'` the app sees the original URL, so routes stay under `/api/v1/…`. Leave out `preferStatic`: with it, Netlify treats the SPA rewrite below (`/* → /index.html`) as a static match, and every `/api/*` request returns `index.html` instead of reaching the function.

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

**API only:** set `bundle` in the script to `'../../../dist/serverless/server.mjs'`, build with `vite build --config vite.serverless.config.ts && node scripts/write-netlify-function.mjs`, and drop the SPA redirect. Set `publish` to an empty folder (a `public/` with a `.gitkeep`): without it, Netlify publishes the project's base directory as static files.

## Vercel

Write the [Build Output API](https://vercel.com/docs/build-output-api) tree. Vercel serves it either way you deploy:

- **Git-connected project:** the build command writes the tree on Vercel, which then uses `.vercel/output` as the deployment. Set the command in `vercel.json` at the repo root, with `framework: null` so Vercel doesn't treat the repo as a plain Vite app. `build:vercel` is a root script that runs `pnpm build` and then writes the tree — the [CLI plugin](#build-with-a-cli-plugin-optional) ships the writer as `kick build:vercel`:

  ```json
  {
    "$schema": "https://openapi.vercel.sh/vercel.json",
    "framework": null,
    "buildCommand": "pnpm build:vercel"
  }
  ```

- **From your machine or CI:** write the tree locally, then `vercel deploy --prebuilt` from the directory holding `.vercel/`.

The tree:

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

## Build it with one command

`kick build:netlify` and `kick build:vercel` do everything above: they bundle `src/serverless.ts` with the same Vite + SWC setup as `kick build`, then write the platform's output around it. Both ship with the CLI, so there is nothing to install — a project scaffolded by `kick new` already has the scripts and the platform files.

```bash
kick build            # the long-running server, as always
kick build:netlify    # → .netlify/v1/functions/api.mjs
kick build:vercel     # → .vercel/output (Build Output API v3)
```

Run them **after** `kick build`, and for fullstack after the web build too — `build:vercel` copies `web/dist` and fails if it is missing. The generated scripts already chain that:

::: code-group

```json [Fullstack (root package.json)]
{
  "scripts": {
    "build": "pnpm --filter ./server exec kick typegen && pnpm -r run build",
    "build:netlify": "pnpm build && pnpm --filter ./server exec kick build:netlify",
    "build:vercel": "pnpm build && pnpm --filter ./server exec kick build:vercel"
  }
}
```

```json [API only (package.json)]
{
  "scripts": {
    "build:netlify": "kick build && kick build:netlify",
    "build:vercel": "kick build && kick build:vercel"
  }
}
```

:::

### What it figures out

With no configuration, the commands read the project's layout. A project whose parent directory is a workspace with a sibling `web` package is fullstack; anything else is API-only:

|                            | Fullstack                               | API only                                                   |
| -------------------------- | --------------------------------------- | ---------------------------------------------------------- |
| Static files               | `../web/dist`, published beside the API | none                                                       |
| `.netlify/` and `.vercel/` | the workspace root                      | the project itself                                         |
| Function path              | `/api/*`                                | `/*` — every path, so unknown routes get the app's own 404 |
| Netlify `publish`          | `web/dist`                              | `dist/public`, an empty directory the build creates        |

### When you need something else

Override any of it in `kick.config.ts`. Every field is optional and beats detection:

```ts
export default defineConfig({
  deploy: {
    // Keep an API-only project's routes under /api instead of taking every path.
    apiPath: '/api',
    // entry, outDir, staticDir (false = API only), siteRoot, publishDir,
    // external, vercelRuntime — see the DeployConfig type.
  },
})
```

Both commands are a [CLI plugin](./cli-plugins.md) like any other (`kick/deploy`), so the same contract covers a platform that isn't here: ship a plugin with your own command name (`kick build:fly`, say) and it sits beside these. The built-in owns `build:netlify` and `build:vercel` — a plugin claiming either name is a startup conflict, not an override — so to change what they write, take their output further in a command of your own.

## API only: the function owns every path

An API-only project (`kick new --template rest` or `minimal`) has no frontend to share the domain with. `kick new` wires all of this up and the commands detect it — the table is here for a project you are converting by hand:

|                      | Fullstack                                    | API only           |
| -------------------- | -------------------------------------------- | ------------------ |
| Project root         | workspace root (`server/`, `web/`)           | the project itself |
| Detected settings    | `staticDir: '../web/dist'`, `siteRoot: '..'` | `apiPath: ''`      |
| Function path        | `/api/*`                                     | `/*`               |
| Netlify `publish`    | `web/dist`                                   | an empty directory |
| Typegen before build | yes (`web` reads the route map)              | no                 |

`apiPath: ''` gives the function `path: '/*'` and leaves Vercel with one route, `^/(.*)$ → /api`. Every request reaches the app, so an unknown path gets the app's own [problem+json 404](./error-handling.md) rather than the platform's page. Keep `/api` only if you want paths outside it to 404 at the edge.

Nothing to register: an API-only project is what the commands assume when there is no sibling `web` package. Set `deploy: { apiPath: '/api' }` in `kick.config.ts` to keep routes under `/api` instead.

**Netlify** still needs something to publish. `kick build:netlify` creates the empty `dist/public` for that; without it Netlify publishes the project directory itself, serving your source tree as static files — and those files would then shadow the function:

```toml
# netlify.toml
[build]
  # Writes .netlify/v1/functions/api.mjs (every path) and dist/public.
  command = "pnpm run build:netlify"
  publish = "dist/public"

[build.environment]
  NODE_VERSION = "22"
```

```json
// package.json
{
  "scripts": {
    "build:netlify": "kick build && kick build:netlify",
    "build:vercel": "kick build && kick build:vercel"
  }
}
```

**Vercel** reads `.vercel/output` from the project root, the same as fullstack: `vercel.json` with `"buildCommand": "pnpm build:vercel"` for a Git-connected project, or `pnpm build:vercel && vercel deploy --prebuilt` from your machine.

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
