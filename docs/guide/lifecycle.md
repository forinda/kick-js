# Application Lifecycle

KickJS applications follow a deterministic lifecycle from boot to shutdown. Understanding when each hook fires helps you wire adapters, middleware, and modules correctly.

## Boot Sequence

```
┌──────────────────────────────────────────────────────┐
│  new Application({ modules, adapters, middleware })   │
└──────────────────┬───────────────────────────────────┘
                   │
                   ▼
┌──────────────────────────────────────────────────────┐
│  setup()                                              │
│                                                       │
│  1. adapter.beforeMount({ app, container })           │
│     → Register early routes (health, docs UI)         │
│     → AdapterContext: app ✓ container ✓ server ✗      │
│                                                       │
│  2. Hardened defaults                                 │
│     → Disable x-powered-by                            │
│     → Set trust proxy                                 │
│                                                       │
│  3. Adapter middleware: beforeGlobal                  │
│                                                       │
│  4. Plugin registration + middleware                  │
│                                                       │
│  5. Global middleware (user-declared)                 │
│     → helmet, cors, requestId, express.json, etc.     │
│                                                       │
│  6. Adapter middleware: afterGlobal                   │
│                                                       │
│  7. Module registration + DI bootstrap               │
│     → module.register(container) for each module      │
│     → @Service, @Repository decorators fire           │
│     → container.bootstrap()                           │
│                                                       │
│  8. Adapter middleware: beforeRoutes                  │
│                                                       │
│  9. Module route mounting                             │
│     → module.routes() for each module                 │
│     → Routes mounted at /{prefix}/v{version}/{path}   │
│     → adapter.onRouteMount(controller, mountPath)     │
│                                                       │
│  10. Route summary logged (dev only)                  │
│      → Controlled by logRoutesTable option            │
│                                                       │
│  11. Adapter middleware: afterRoutes                  │
│                                                       │
│  12. Error handlers                                   │
│      → notFoundHandler (404)                          │
│      → errorHandler (500)                             │
│                                                       │
│  13. adapter.beforeStart({ app, container })          │
│      → Last chance before server listens              │
│      → AdapterContext: app ✓ container ✓ server ✗     │
│                                                       │
└──────────────────┬───────────────────────────────────┘
                   │
                   ▼
┌──────────────────────────────────────────────────────┐
│  start()                                              │
│                                                       │
│  14. server = http.createServer(app)                  │
│  15. server.listen(port)                              │
│                                                       │
│  16. adapter.afterStart({ app, container, server })   │
│      → Attach WebSocket, start cron jobs              │
│      → AdapterContext: app ✓ container ✓ server ✓     │
│                                                       │
│  17. plugin.onReady(container)                        │
│                                                       │
│  ✅ Server running on http://localhost:{port}          │
│                                                       │
└──────────────────┬───────────────────────────────────┘
                   │
            SIGINT / SIGTERM
                   │
                   ▼
┌──────────────────────────────────────────────────────┐
│  shutdown()                                           │
│                                                       │
│  18. adapter.shutdown() — all adapters concurrently   │
│      → Close DB connections, flush queues             │
│      → Promise.allSettled (one failure won't block)   │
│                                                       │
│  19. server.close()                                   │
│  20. process.exit(0)                                  │
│                                                       │
└──────────────────────────────────────────────────────┘
```

## AdapterContext Availability

The `AdapterContext` fields become available at different stages:

| Field | `beforeMount` | `beforeStart` | `afterStart` | `shutdown` |
|-------|:---:|:---:|:---:|:---:|
| `app` | ✓ | ✓ | ✓ | — |
| `container` | ✓ | ✓ | ✓ | — |
| `server` | — | — | ✓ | — |
| `env` | ✓ | ✓ | ✓ | — |
| `isProduction` | ✓ | ✓ | ✓ | — |

::: tip
`shutdown()` receives no context — it's a cleanup-only hook. Access anything you need via instance properties set during earlier hooks.
:::

## Hook Purposes

| Hook | When | Use for |
|------|------|---------|
| `beforeMount` | Before middleware pipeline | Early routes (health, docs UI), request handlers that must run first (Sentry) |
| `middleware()` | During pipeline assembly | Injecting middleware at specific phases |
| `onRouteMount` | Per module route | Collecting route metadata (Swagger spec generation) |
| `beforeStart` | After all routes, before listen | Registering DI bindings, final config |
| `afterStart` | After server is listening | Attaching to http.Server (WebSocket, cron scheduler) |
| `shutdown` | On SIGINT/SIGTERM | Closing connections, flushing buffers |

## HMR Rebuild (Dev Mode)

During `kick dev`, file changes trigger an HMR rebuild — a faster path than a full cold start:

```
┌─────────────────────────────────────┐
│  File saved                          │
│                                      │
│  1. Vite invalidates changed modules │
│  2. Application.rebuild()            │
│     → Reruns setup() (steps 1-13)    │
│     → Swaps Express request handler  │
│     → Does NOT restart http.Server   │
│                                      │
│  Preserved across rebuild:           │
│    ✓ http.Server + port binding      │
│    ✓ Database connections            │
│    ✓ Redis pools                     │
│    ✓ WebSocket connections           │
│    ✓ Active client connections       │
│                                      │
│  Recreated on rebuild:               │
│    ↻ Express app + middleware        │
│    ↻ Route handlers                  │
│    ↻ DI container bindings           │
│    ↻ Adapter beforeMount/beforeStart │
│                                      │
└─────────────────────────────────────┘
```

::: warning
`afterStart` does NOT rerun during HMR rebuild — the server is already listening. Only `beforeMount` and `beforeStart` fire again. Design adapters accordingly: WebSocket servers attached in `afterStart` survive rebuilds, while middleware registered in `beforeMount` is refreshed.
:::

## Cold Start vs HMR Rebuild

| Step | Cold Start | HMR Rebuild |
|------|:---:|:---:|
| `new Application()` | ✓ | — |
| `setup()` (steps 1-13) | ✓ | ✓ |
| `server.listen()` | ✓ | — |
| `afterStart` hooks | ✓ | — |
| `shutdown` hooks | on exit | — |

## bootstrap() vs Manual Wiring

The `bootstrap()` helper from `@forinda/kickjs` handles the full lifecycle:

```ts
import { bootstrap } from '@forinda/kickjs'

// This calls: new Application() → setup() → start()
// Plus: HMR wiring, SIGINT/SIGTERM handlers, port conflict detection
bootstrap({
  modules: [UserModule],
  middleware: [helmet(), cors(), express.json()],
  adapters: [new SwaggerAdapter({ ... })],
})
```

For manual control:

```ts
import { Application } from '@forinda/kickjs'

const app = new Application({ modules, adapters, middleware })
app.setup()           // steps 1-13
app.start()           // steps 14-17
// app.shutdown()     // steps 18-20 (called on SIGINT/SIGTERM)
```

## Example: Adapter Lifecycle

A database adapter demonstrates all hooks:

```ts
import type { AppAdapter, AdapterContext } from '@forinda/kickjs'

export class DatabaseAdapter implements AppAdapter {
  name = 'DatabaseAdapter'
  private pool: any

  beforeMount({ isProduction }: AdapterContext): void {
    // Step 1: create connection pool with env-aware config
    this.pool = createPool({
      max: isProduction ? 20 : 5,
    })
  }

  beforeStart({ container }: AdapterContext): void {
    // Step 13: register in DI so services can inject it
    container.registerInstance(DB_POOL, this.pool)
  }

  afterStart({ server }: AdapterContext): void {
    // Step 16: log connection info after server is ready
    console.log(`Database pool ready (${this.pool.totalCount} connections)`)
  }

  async shutdown(): Promise<void> {
    // Step 18: drain and close connections
    await this.pool.end()
  }
}
```
