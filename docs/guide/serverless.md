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
  preferStatic: true,
}
`,
)
```

Run it from the project root; it writes `.netlify/v1/functions/api.mjs`.

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

## Build with a CLI plugin (optional)

The steps above are the whole recipe, and they stay the reference. If you would rather run one command per platform, put them in a [CLI plugin](./cli-plugins.md): `kick build:netlify` and `kick build:vercel` bundle `src/serverless.ts` with the same Vite + SWC setup and write the platform output around it. The plugin replaces `vite.serverless.config.ts` and `scripts/write-netlify-function.mjs`; `src/serverless.ts` stays as it is.

`kick build` has no `--target` flag: it always builds `vite.config.ts` into a long-running server. The plugin is how a project gets platform builds today.

Copy the plugin into the server project. It only uses packages a generated project already has (`vite`, `unplugin-swc`, `@forinda/kickjs-vite`):

```ts
// server/kick-deploy.ts
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { relative, resolve, sep } from 'node:path'
import { defineCliPlugin } from '@forinda/kickjs-cli'

export interface DeployPluginOptions {
  /** Serverless entry exporting `handler = createHandler(...)`. Default `src/serverless.ts`. */
  entry?: string
  /** Where the bundle is written, under the project. Default `dist/serverless`. */
  outDir?: string
  /**
   * Built frontend to publish next to the API (fullstack: `../web/dist`).
   * Omit for an API-only project.
   */
  staticDir?: string
  /**
   * Directory the platform deploys from, relative to the project — where
   * `.netlify/` and `.vercel/` are written. Fullstack: `..` (the workspace root).
   */
  siteRoot?: string
  /** URL prefix routed to the function. Default `/api`. */
  apiPath?: string
  /**
   * Optional peers to leave out of the bundle when they are not installed.
   * Installed ones are always bundled: a Vercel function can't see node_modules.
   * Default `['valibot', 'yup']`.
   */
  external?: string[]
  /** Vercel Node runtime. Default `nodejs22.x`. */
  vercelRuntime?: string
}

/**
 * `kick build:netlify` and `kick build:vercel`: bundle the serverless entry
 * with the same Vite + SWC setup as `kick build`, then write the platform's
 * build output around it.
 */
export const deployPlugin = (options: DeployPluginOptions = {}) =>
  defineCliPlugin({
    name: 'deploy',
    register(program, ctx) {
      const opts = {
        entry: 'src/serverless.ts',
        outDir: 'dist/serverless',
        siteRoot: '.',
        apiPath: '/api',
        external: ['valibot', 'yup'],
        vercelRuntime: 'nodejs22.x',
        ...options,
      }
      const root = ctx.projectRoot
      const siteRoot = resolve(root, opts.siteRoot)
      const staticDir = opts.staticDir ? resolve(root, opts.staticDir) : undefined

      /** Build dist/serverless/server.mjs: one self-contained ESM file. */
      async function bundle(): Promise<string> {
        // Loaded here, not at the top: only these commands need them.
        const { build } = await import('vite')
        const { default: swc } = await import('unplugin-swc')
        const { devtoolsFlagPlugin, devtoolsStripPlugin } = await import('@forinda/kickjs-vite')

        await build({
          configFile: false,
          root,
          logLevel: 'warn',
          oxc: false,
          plugins: [swc.vite(), devtoolsFlagPlugin(), devtoolsStripPlugin()],
          resolve: { alias: { '@': resolve(root, 'src') } },
          // Inline every dependency: a Vercel function can't see node_modules
          // outside it, and Netlify must not re-compile the TypeScript.
          ssr: { noExternal: true, target: 'node' },
          build: {
            ssr: true,
            target: 'node20',
            outDir: resolve(root, opts.outDir),
            emptyOutDir: true,
            minify: false,
            rollupOptions: {
              input: resolve(root, opts.entry),
              // Inlined, a missing optional peer becomes a stub that throws on load;
              // left external, an installed one is unreachable from api.func.
              external: opts.external.filter(
                (name) => !existsSync(resolve(root, 'node_modules', name)),
              ),
              output: { format: 'esm', entryFileNames: 'server.mjs', codeSplitting: false },
            },
          },
        })
        const file = resolve(root, opts.outDir, 'server.mjs')
        ctx.log(`bundled ${relative(process.cwd(), file)}`)
        return file
      }

      program
        .command('build:netlify')
        .description('Bundle the API and write the Netlify function')
        .action(async () => {
          const server = await bundle()
          const functions = resolve(siteRoot, '.netlify/v1/functions')
          mkdirSync(functions, { recursive: true })
          // The function imports the bundle; Netlify packages what it imports.
          const from = relative(functions, server).split(sep).join('/')
          writeFileSync(
            resolve(functions, 'api.mjs'),
            `import { handler } from '${from}'

export default (request) => handler.fetch(request)

export const config = {
  path: '${opts.apiPath}/*',
  preferStatic: true,
}
`,
          )
          ctx.log(`wrote ${relative(process.cwd(), resolve(functions, 'api.mjs'))}`)
        })

      program
        .command('build:vercel')
        .description('Bundle the API and write .vercel/output (Build Output API v3)')
        .action(async () => {
          const server = await bundle()
          const output = resolve(siteRoot, '.vercel/output')
          const fn = resolve(output, 'functions/api.func')
          rmSync(output, { recursive: true, force: true })
          mkdirSync(fn, { recursive: true })

          // Nothing outside the .func directory is visible at runtime.
          cpSync(server, resolve(fn, 'server.mjs'))
          writeFileSync(
            resolve(fn, 'index.mjs'),
            `import { handler } from './server.mjs'\nexport default handler.node\n`,
          )
          writeFileSync(
            resolve(fn, '.vc-config.json'),
            JSON.stringify(
              {
                runtime: opts.vercelRuntime,
                handler: 'index.mjs',
                launcherType: 'Nodejs',
                supportsResponseStreaming: true,
              },
              null,
              2,
            ),
          )

          const routes: Array<Record<string, string>> = [
            { handle: 'filesystem' },
            { src: `^${opts.apiPath}/(.*)$`, dest: '/api' },
          ]
          if (staticDir) {
            if (!existsSync(staticDir)) {
              throw new Error(
                `build:vercel: ${staticDir} does not exist — build the frontend first`,
              )
            }
            cpSync(staticDir, resolve(output, 'static'), { recursive: true })
            // Client-side routes fall back to the SPA shell.
            routes.push({ src: '^/(.*)$', dest: '/index.html' })
          }
          writeFileSync(
            resolve(output, 'config.json'),
            JSON.stringify({ version: 3, routes }, null, 2),
          )
          ctx.log(`wrote ${relative(process.cwd(), output)}`)
        })
    },
  })
```

Register it in `kick.config.ts`:

::: code-group

```ts [Fullstack (server/kick.config.ts)]
import { defineConfig } from '@forinda/kickjs-cli'
import { deployPlugin } from './kick-deploy'

export default defineConfig({
  // web/dist is published next to the API; .netlify/ and .vercel/ go to the
  // workspace root, where the platform builds.
  plugins: [deployPlugin({ staticDir: '../web/dist', siteRoot: '..' })],
  // ...
})
```

```ts [API only (kick.config.ts)]
import { defineConfig } from '@forinda/kickjs-cli'
import { deployPlugin } from './kick-deploy'

export default defineConfig({
  plugins: [deployPlugin()],
  // ...
})
```

:::

`kick --help` now lists both commands. Run them **after** `kick build` and, for fullstack, after the web build — `build:vercel` copies `web/dist` and fails if it is missing. One root script per platform keeps that order, and the platform config only has to name it:

```json
// package.json (workspace root) — `build` runs typegen, see "Before the platform builds"
{
  "scripts": {
    "build": "pnpm --filter ./server exec kick typegen && pnpm -r run build",
    "build:netlify": "pnpm build && pnpm --filter ./server exec kick build:netlify",
    "build:vercel": "pnpm build && pnpm --filter ./server exec kick build:vercel"
  }
}
```

API only: `"build:netlify": "pnpm build && pnpm exec kick build:netlify"` and the same for `build:vercel`; the project's own `build` needs no typegen step.

**Netlify** — the build command writes the function, as Netlify requires:

```toml
# netlify.toml (at the repo root)
[build]
  command = "pnpm build:netlify"
  publish = "web/dist"

[[redirects]]
  from = "/*"
  to = "/index.html"
  status = 200
```

API only: no SPA redirect, and `publish` an empty folder as described in [Netlify](#netlify).

**Vercel** — a Git-connected project builds with the `vercel.json` from [Vercel](#vercel) (`"buildCommand": "pnpm build:vercel"`). To deploy from your machine or CI instead:

```bash
pnpm build:vercel
vercel deploy --prebuilt   # from the repo root, which holds .vercel/
```

Both platforms build from the repo root — see [the settings table](#before-the-platform-builds).

Add `.netlify/` and `.vercel/` to `.gitignore`. Change the options — `apiPath`, `external`, `vercelRuntime` — instead of editing the output by hand; anything the plugin doesn't cover (extra functions, headers, edge config) is plain file writing in the same `register` function.

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
