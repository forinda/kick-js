# Hot Module Replacement (HMR)

KickJS uses Vite's HMR to provide zero-downtime reloading during development. When you save a file, the Express handler is rebuilt and swapped on the existing HTTP server. Database pools, Redis connections, and port bindings survive across reloads.

## How It Works

The `kick dev` command starts a Vite dev server using the native `RunnableDevEnvironment` API. Vite watches your source files and triggers module re-execution when changes are detected.

### The bootstrap() Function

The `bootstrap()` function from `@forinda/kickjs` handles the entire HMR lifecycle:

```ts
import { bootstrap } from '@forinda/kickjs'
import { modules } from './modules'

bootstrap({ modules })
```

On the first call, `bootstrap()` creates the application, registers error/shutdown handlers, and starts the HTTP server. On subsequent calls (triggered by HMR), it rebuilds the Express app and swaps the request handler on the existing server — no restart needed.

### What Is Preserved

| Preserved across HMR | Rebuilt on each reload |
|-----------------------|----------------------|
| `http.Server` instance | Express app |
| Port binding | Middleware stack |
| TCP connections | Route table |
| Database connection pools | DI container singletons |
| Redis clients | Controller instances |
| Socket.IO server | Service instances |

The HTTP server is created once and never recreated. Only the request handler is swapped, so existing connections and listeners remain intact.

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

## Graceful Shutdown

When the process receives `SIGINT` or `SIGTERM`, `bootstrap()` calls `app.shutdown()` which:

1. Runs all adapter `shutdown()` methods concurrently via `Promise.allSettled`
2. Closes the HTTP server
3. Exits the process

Adapter shutdown failures are logged but do not prevent other adapters from cleaning up.

## Troubleshooting

### Raw JSON logs instead of colored output

Pino uses a worker thread to load `pino-pretty`. Vite's SSR bundler can't resolve it from the bundled output. Fix: add `pino` and `pino-pretty` to `ssr.external` in your `vite.config.ts`:

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
