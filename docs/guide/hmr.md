# Hot Module Replacement (HMR)

KickJS uses Vite's HMR to provide zero-downtime reloading during development. When you save a file, the handler is rebuilt and swapped on the existing HTTP server, so the port binding and open TCP connections survive across reloads. Anything an adapter or plugin owns — database pools, Redis clients, queue consumers — is torn down and rebuilt, because the previous app's `shutdown()` runs first. Only resources outside the adapter/plugin lifecycle persist.

## How It Works

The `kick dev` command starts a Vite dev server using the native `RunnableDevEnvironment` API. Vite watches your source files and triggers module re-execution when changes are detected.

### The bootstrap() Function

The `bootstrap()` function from `@forinda/kickjs` handles the entire HMR lifecycle:

```ts
import { bootstrap } from '@forinda/kickjs'
import { modules } from './modules'

bootstrap({ modules })
```

On the first call, `bootstrap()` creates the application and registers error/shutdown handlers. In dev, Vite owns the `http.Server` and exposes it as `globalThis.__kickjs_httpServer`; `bootstrap()` attaches to that server rather than creating or listening on its own. (Outside dev, with no such global, it does create and listen.) On subsequent calls (triggered by HMR), it **tears the previous app down**, rebuilds the Express app, and swaps the request handler on the existing server — no restart needed.

### What Is Preserved

| Preserved across HMR   | Rebuilt on each reload         |
| ---------------------- | ------------------------------ |
| `http.Server` instance | Express app                    |
| Port binding           | Middleware stack               |
| TCP connections        | Route table                    |
|                        | DI container singletons        |
|                        | Controller / service instances |
|                        | Adapters and plugins           |

The HTTP server is created once — by Vite in dev — and never recreated. Only the
request handler is swapped, so existing connections and listeners remain intact.

Everything an adapter or plugin owns — database pools, Redis clients, Socket.IO
servers, message-queue consumers — is **rebuilt**, because the previous app's
`shutdown()` runs before the new one starts.

::: warning This changed
Adapter-held resources used to be described as preserved. They were not
preserved so much as **abandoned**: the old app was replaced without being shut
down, so its adapters kept running and each save added another set.

That surfaced as one process holding several message-queue consumer-group
members — on a single-partition topic only one can hold the assignment, and it
was a leaked consumer wired to nothing, so jobs silently stopped being
processed. Two Socket.IO servers on the same HTTP server crashed
`handleUpgrade()` the same way.

The trade is deliberate: reconnecting a pool on each reload costs a moment,
whereas leaking one costs a debugging session. If a resource is genuinely
expensive to rebuild, hold it outside the adapter lifecycle — on `globalThis`,
or behind a module-level singleton the adapter reuses.
:::

## Configuring Vite

A minimal `vite.config.ts` for HMR support:

```ts
import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    target: 'node20',
    ssr: true,
    rollupOptions: {
      input: 'src/index.ts',
    },
  },
})
```

The `kick dev` command uses Vite's Environment Runner which reads this config automatically. No additional HMR configuration is needed.

## Errors Surface on Save

After an invalidation (a token change or a module-file add/remove), the dev server eagerly re-evaluates `virtual:kickjs/app` instead of waiting for the next HTTP request. A broken save — syntax error, failed import, bootstrap throw — prints immediately:

```text
[vite] [kickjs] app failed to reload after HMR invalidation (1 token): x Expected ',', got ':'
```

The next successful save heals it; the dev loop never dies mid-edit.

## Custom HMR Events

Dev tools (the DevTools dashboard, Swagger UI, custom overlays) can subscribe to the channel KickJS broadcasts on:

| Event                  | Payload                      | Fired when                                                      |
| ---------------------- | ---------------------------- | --------------------------------------------------------------- |
| `kickjs:hmr`           | `{ tokens, timestamp }`      | A batch of DI tokens was invalidated                            |
| `kickjs:typegen-error` | `{ message, timestamp }`     | A watch-mode typegen pass failed (types may be stale)           |
| `kickjs:typecheck`     | `{ ok, output, durationMs }` | A `kick dev --typecheck` run finished (full diagnostics inside) |

```ts
import.meta.hot?.on('kickjs:typecheck', (data) => {
  if (!data.ok) overlay.show(data.output)
})
```

### Writing an adapter that survives reloads

Because `shutdown()` now runs on every rebuild and the adapter is then mounted
again — often the _same instance_, since `config/adapters.ts` may not
re-evaluate — an adapter has to be restartable, not just stoppable. Release the
handle and null it out, so the next `beforeMount()` builds a fresh one:

```ts
let io: Server | undefined

export const SocketAdapter = defineAdapter({
  name: 'Socket',
  build: () => ({
    beforeStart({ server }) {
      io = new Server(server) // rebuilt on each reload
    },
    async shutdown() {
      if (!io) return
      await new Promise<void>((resolve) => io!.close(() => resolve()))
      io = undefined // ← without this, the next mount reuses a closed handle
    },
  }),
})
```

An adapter that closes a resource without clearing its reference will appear to
work on first boot and fail on the first save.

## Graceful Shutdown

`app.shutdown()` runs on two paths, and they differ in one respect.

**On `SIGINT` / `SIGTERM`** — the full sequence:

1. Closes the HTTP server to stop accepting connections
2. Waits for in-flight requests to drain (up to `shutdownTimeout`, default 30s)
3. Runs all plugin and adapter `shutdown()` methods concurrently via `Promise.allSettled`
4. Releases framework-owned resources (session / rate-limit intervals)
5. Exits the process

**On an HMR rebuild** — `shutdown({ closeServer: false })`, which runs steps 3
and 4 only. The dev HTTP server is shared across rebuilds, so closing it would
kill HMR on the first save; draining is skipped for the same reason, since the
server keeps serving and there is nothing to drain toward.

Plugin and adapter shutdown failures are logged but do not prevent the others
from cleaning up — and on the HMR path a failure cannot leave the dev server
with no app at all.

## Troubleshooting

### Raw JSON logs instead of colored output (Pino provider)

The default logger is `console`-based and needs no setup. This only applies if
you've opted into the **Pino** logger via `Logger.setProvider()`: Pino loads
`pino-pretty` in a worker thread, which Vite's SSR bundler can't resolve from the
bundled output. Fix: add `pino` and `pino-pretty` to `ssr.external` in your
`vite.config.ts`:

```ts
export default defineConfig({
  ssr: {
    external: ['pino', 'pino-pretty'],
  },
  // ...
})
```

This tells Vite not to bundle these modules — Node.js resolves them at runtime, allowing the worker thread to find `pino-pretty`.

### `kick.config.ts` changes not picked up

`kick dev` watches `kick.config.ts` and automatically restarts the Vite server when it changes. If the restart doesn't happen, ensure:

- The file is named `kick.config.ts` (not `.js` or `.mjs`) — only `.ts` is watched
- You're running `kick dev`, not `npx vite` directly

### `(client) warning: Module "node:*" externalized`

This warning appears when Vite creates a client environment alongside the SSR environment. It's harmless for backend apps. KickJS's `kick dev` filters these warnings automatically. If you see them, rebuild the CLI: `pnpm --filter @forinda/kickjs-cli build`.
