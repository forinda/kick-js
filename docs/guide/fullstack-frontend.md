# Wiring your own frontend

`kick new --template fullstack` asks who scaffolds `web/`. Pick **Delegate to create-vite** and the CLI asks which framework — React, Vue, Svelte, Solid, Preact, Lit, Qwik or vanilla — then runs `create-vite` with that template and wires **nothing**.

Only TypeScript templates are offered: the route map is a `.d.ts` and the client is `createClient<KickClientApi.Api>`, so a JavaScript template would leave you following a guide that cannot apply. For a scripted run, `--frontend vite --vite-template svelte-ts` skips both questions. Your app is yours; this page is the four steps that connect it to the API, and how to deploy the result.

The wired option does all of this for you. Choose it if you want the React app rather than the framework of your choice.

The server side is already done either way: `server/` boots on port 3000 with `strictPort`, has `typegen: { client: true }` in its `kick.config.ts`, serves `web/dist` in production through `SpaAdapter`, and the workspace root carries the deploy config.

## 1. Install the typed client

```bash
pnpm --filter ./web add @forinda/kickjs-client
```

## 2. Proxy `/api` to the server in dev

The client calls `/api/v1` on its own origin, so Vite forwards those requests to KickJS while you develop:

```ts
// web/vite.config.ts
export default defineConfig({
  // ...whatever create-vite wrote
  server: {
    // `kick dev` listens on 3000 with strictPort — it fails rather than
    // moving, so this proxy can never reach the wrong process.
    proxy: { '/api': 'http://localhost:3000' },
  },
})
```

Run both with `pnpm dev` at the workspace root (or `dev:server` and `dev:web` in two terminals with npm, yarn or bun), and open Vite's URL, not port 3000. If you change the server's port, change it here too.

## 3. Point TypeScript at the route map

`kick typegen` writes `server/.kickjs/types/kick__client.d.ts`: the response type of every route, resolved to plain shapes, as an ambient `KickClientApi` namespace. Nothing from the server's source enters the web app's TypeScript program.

Add it to the config that compiles `src` — in create-vite's TypeScript templates that is **`web/tsconfig.app.json`**, not the root `web/tsconfig.json`, which only references the others. **Append** to the existing `types`; replacing the list drops `vite/client`, and with it the typing for `import.meta.env` and asset imports:

```jsonc
// web/tsconfig.app.json
{
  "compilerOptions": {
    // A `types` entry, not an `include`: the map is an ambient type package,
    // not source of this app. It must exist — a missing file reports TS2688,
    // which is the failure you want for something the app depends on.
    "types": ["vite/client", "../server/.kickjs/types/kick__client"],
  },
}
```

Paths in `types` resolve relative to the config file, so a config in a subdirectory needs one more `../`.

### When the map is refreshed

Producing the map builds a TypeScript program over the whole server, so it is a build step, not a per-save one:

- `kick new` writes it once, and the root `build` script runs `kick typegen` before building `web/`, so a production build always has a current map.
- **`kick dev` does not refresh it.** After you add a route or change what a handler returns, run `kick typegen` in `server/` — `pnpm --filter ./server exec kick typegen` from the root — and the web app's types follow.
- `kick typegen --check` fails when the map is stale; put it in CI.
- On TypeScript 7 the map needs the TypeScript 6 compiler API. The fullstack server already has `@typescript/typescript6` as a dev dependency; without it, `kick typegen` warns and skips the map.

[Typed client](./typed-client.md#frontends-outside-the-server-s-typescript-program) covers the map's options and limits.

## 4. Create the client

```ts
// web/src/api.ts
import { createClient } from '@forinda/kickjs-client'

// `KickClientApi` is ambient, from the types entry above. Keys are
// module-mount-relative paths; the '/api/v1' prefix the server adds lives
// here. VITE_API_URL is empty unless the API is on another origin.
export const api = createClient<KickClientApi.Api>({
  baseUrl: `${import.meta.env.VITE_API_URL ?? ''}/api/v1`,
})
```

Then call it — the path, the params and the response are all typed from the server's routes:

```ts
const hello = await api.get('/hello')
```

See [Typed client](./typed-client.md) for the full API.

## What it costs you

Everything the [fullstack template](./generators.md) ships pre-wired, you do yourself:

|                              | Wired template      | create-vite |
| ---------------------------- | ------------------- | ----------- |
| Framework                    | React               | your choice |
| `@forinda/kickjs-client`     | installed           | step 1      |
| `/api` dev proxy             | in `vite.config.ts` | step 2      |
| Route-map types              | in `tsconfig.json`  | step 3      |
| `src/api.ts`                 | written             | step 4      |
| Example page calling the API | `src/App.tsx`       | yours       |

## Deploying

The question is whether the browser reaches the API on the same origin as the web app. When it does, `VITE_API_URL` stays unset, the client calls the relative `/api/v1`, and there is no CORS to configure.

### One origin

**One Node process** — Render, Railway, Fly.io, a VM, a container. The root `build` script builds both apps, and the server serves the web app through `SpaAdapter`:

```bash
pnpm install && pnpm build    # typegen, server build, web build
cd server && pnpm start       # kick start — API on /api, web/dist for everything else
```

Deploy the whole workspace, since the server reads `../web/dist` at runtime. Set `PORT` to whatever the platform gives you; nothing in `web/` changes.

**Netlify or Vercel** — `pnpm build:netlify` or `pnpm build:vercel`. The platform serves `web/dist` and runs the API as a function on `/api/*` of the same site. [Serverless](./serverless.md) covers both, including the `serverless.ts` entry that leaves `SpaAdapter` out.

### Separate deploys

The web app on one host (a static site anywhere), the API on another. Two ways to connect them:

**Proxy `/api` from the web host to the API** — the browser still sees one origin, so `VITE_API_URL` stays unset, there is no CORS, and cookies stay first-party. Netlify redirects and Vercel rewrites do this ([Two deploys](./serverless.md#two-deploys)); on your own server it is one rule:

```nginx
location /api/ { proxy_pass https://api.example.com; }
```

**Call the API directly** — build the web app with the API's origin, and let the API accept requests from the web app's:

```bash
VITE_API_URL=https://api.example.com pnpm --filter ./web build
```

```ts
// server/src/index.ts
import { bootstrap, cors } from '@forinda/kickjs'

export const app = await bootstrap({
  modules,
  middlewares: [cors({ origin: ['https://app.example.com'] })],
  // ...the rest of your options
})
```

`VITE_*` values are baked in when Vite builds, so set it in the web host's build environment, not at runtime. See [CORS](./security-headers.md#cors) for the options.

For cookies — a session, a CSRF token — the browser only sends them cross-origin when the request asks for it and the API allows it:

```ts
// web/src/api.ts
export const api = createClient<KickClientApi.Api>({
  baseUrl: `${import.meta.env.VITE_API_URL ?? ''}/api/v1`,
  fetch: (request) => fetch(request, { credentials: 'include' }),
})
```

```ts
// server: allow credentials for that exact origin (never with '*')
cors({ origin: ['https://app.example.com'], credentials: true })
```

The cookies themselves need `SameSite=None; Secure` when the two sites are on different domains. If that is more than you want to manage, use the proxy instead.

In both separate setups the API deploys without the web app. `SpaAdapter` then has no `../web/dist` to serve: it logs a warning at boot and leaves every route to the API. Remove it from `server/src/adapters/index.ts` to drop the warning.

### A frontend that builds somewhere else

Everything above assumes `web/dist`, Vite's default in every framework template. If your framework builds somewhere else — SvelteKit's `build/`, say — three places name that directory, and all three have to agree:

```ts
// 1. server/kick.config.ts — what the deploy commands copy and publish
export default defineConfig({
  deploy: { staticDir: '../web/build' },
})
```

```ts
// 2. server/src/adapters/index.ts — what SpaAdapter serves from the API process
export const adapters = [SpaAdapter({ clientDir: '../web/build' })]
```

```toml
# 3. netlify.toml — what Netlify publishes
[build]
  publish = "web/build"
```

`kick build:netlify` warns when `netlify.toml` and the deploy config disagree, so a missed one shows up at build time rather than in production.
