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

Internally, `bootstrap()` does the following:

**First boot:**
1. Registers global error handlers (`uncaughtException`, `unhandledRejection`)
2. Registers shutdown handlers for `SIGINT` and `SIGTERM`
3. Creates a new `Application` instance
4. Stores it on `globalThis.__app`
5. Calls `app.start()` which runs `setup()` then starts the HTTP server
6. Calls `import.meta.hot.accept()` to tell Vite this module handles its own updates

**Subsequent reloads (HMR):**
1. Detects `globalThis.__app` already exists
2. Calls `app.rebuild()` instead of `app.start()`
3. Returns immediately -- no new server is created

### The rebuild() Method

`Application.rebuild()` performs a surgical swap:

```ts
rebuild(): void {
  Container.reset()
  this.container = Container.getInstance()
  this.app = express()
  this.setup()

  if (this.httpServer) {
    this.httpServer.removeAllListeners('request')
    this.httpServer.on('request', this.app)
  }
}
```

Step by step:

1. **Reset the DI container** -- clears all singletons so they are re-created with fresh code
2. **Get a fresh container instance**
3. **Create a new Express app** -- clean middleware and route stack
4. **Run the full setup pipeline** -- adapters, middleware, modules, routes, error handlers
5. **Swap the request handler** -- remove old listeners on the `http.Server`, attach the new Express app

### What Is Preserved

| Preserved across HMR | Rebuilt on each reload |
|-----------------------|----------------------|
| `http.Server` instance | Express app |
| Port binding | Middleware stack |
| TCP connections | Route table |
| Database connection pools | DI container singletons |
| Redis clients | Controller instances |
| Socket.IO server | Service instances |

The `http.Server` is created once during the first `app.start()` call and never recreated. Only the request handler function is swapped, so existing connections and listeners remain intact.

### globalThis Storage

KickJS uses `globalThis` to persist state across Vite module re-executions:

- `globalThis.__app` -- the Application instance (created once, rebuilt on HMR)
- `globalThis.__kickBootstrapped` -- flag to prevent re-registering process handlers

This pattern works because `globalThis` survives Vite's module invalidation, while module-level variables are reset.

## Vite HMR Acceptance

The key line is `import.meta.hot.accept()` at the end of `bootstrap()`:

```ts
const meta = import.meta as any
if (meta.hot) {
  meta.hot.accept()
}
```

This tells Vite that the entry module handles its own updates. Without this call, Vite would perform a full server restart on every change.

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
