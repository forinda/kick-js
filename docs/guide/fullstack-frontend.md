# Wiring your own frontend

`kick new --template fullstack` asks who scaffolds `web/`. Pick **Delegate to create-vite** and the CLI hands the directory to `create-vite` — you choose React, Vue, Svelte, Solid, whatever it offers — and then wires **nothing**. Choose a **TypeScript** variant when it asks: the steps below are typed, and the route map is a `.d.ts`. Your app is yours; this page is the four steps that connect it to the API.

The wired option does all of this for you. Choose it if you want the React app rather than the framework of your choice.

The server side is already done either way: `server/` boots on port 3000 with `strictPort`, serves `web/dist` in production through `SpaAdapter`, and the workspace root carries the deploy config.

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

## 3. Point TypeScript at the route map

`kick typegen` (run by `kick dev`, and by the root `build` script) writes `server/.kickjs/types/kick__client.d.ts`: the resolved map of every route, as an ambient `KickClientApi` namespace.

Add it to the config that compiles `src` — in create-vite's React and Vue TypeScript templates that is **`web/tsconfig.app.json`**, not the root `web/tsconfig.json`, which only references the others. **Append** to the existing `types`; replacing the list drops `vite/client`, and with it the typing for `import.meta.env` and asset imports:

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

## 4. Create the client

```ts
// web/src/api.ts
import { createClient } from '@forinda/kickjs-client'

// `KickClientApi` is ambient, from the types entry above. Keys are
// module-mount-relative paths; the bootstrap-level '/api/v1' prefix lives
// here in baseUrl, and the dev proxy forwards it.
export const api = createClient<KickClientApi.Api>({ baseUrl: '/api/v1' })
```

Then call it — the path, the params and the response are all typed from the server's routes:

```ts
const hello = await api.get('/hello')
```

Add a route in `server/src/modules`, and the call sites follow on the next typegen. See [Typed client](./typed-client.md) for the full API.

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

Nothing changes while your frontend builds to `web/dist`, which is Vite's default in every framework template: [`kick build:netlify` and `kick build:vercel`](./serverless.md#build-it-with-one-command) publish it, and the server serves it in production.

If your framework builds somewhere else — SvelteKit's `build/`, say — three places name that directory, and all three have to agree:

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
