# Adapters

Adapters plug into the KickJS application lifecycle. Use them to add health checks, CORS, rate limiting, WebSocket support, database connections, Swagger docs, or any cross-cutting concern.

## The `defineAdapter()` factory

v4 declares adapters with `defineAdapter({ name, defaults?, build })` — never `class Foo implements AppAdapter`. The factory captures three things:

- `name` — string, used for diagnostics and the `KickJsPluginRegistry` typegen output. Required.
- `defaults?` — partial config the factory pre-applies before merging the caller's options. Optional.
- `build(config, meta)` — runs once per adapter instance and returns the lifecycle object. Closures inside `build` are how each adapter instance owns its own state (Redis client, database pool, internal Map, etc.).

The returned object implements any subset of the lifecycle hooks below. Every hook is optional — emit only what your adapter actually needs.

```ts
import { defineAdapter, type AdapterContext, type AdapterMiddleware } from '@forinda/kickjs'

interface MyAdapterConfig {
  apiKey?: string
}

export const MyAdapter = defineAdapter<MyAdapterConfig>({
  name: 'MyAdapter',
  defaults: { /* config defaults */ },
  build: (config, { name }) => ({
    /** Express middleware entries to insert at named phases. */
    middleware(): AdapterMiddleware[] { return [] },

    /** Runs before global middleware — mount routes that bypass the stack. */
    beforeMount({ app }: AdapterContext): void | Promise<void> {},

    /** Fires once per controller class as the router mounts. Useful for
     *  building OpenAPI specs, dependency graphs, route inventories. */
    onRouteMount(controllerClass: any, mountPath: string): void {},

    /** Runs after modules + routes are wired, before the server starts. */
    beforeStart({ container }: AdapterContext): void | Promise<void> {},

    /** Runs after the HTTP server is listening — attach upgrade handlers
     *  (Socket.IO, gRPC), warm caches, log a banner. */
    afterStart({ server }: AdapterContext): void | Promise<void> {},

    /** Runs on graceful shutdown. Close connections, flush buffers,
     *  cancel timers. Promises resolve via `Promise.allSettled` so
     *  one failure won't block sibling adapters. */
    async shutdown(): Promise<void> {},

    /** Returns Context Contributors to merge into every route's pipeline.
     *  See ./context-decorators.md. */
    contributors() { return [] },
  }),
})
```

`AdapterContext` (passed to every hook that takes it) is:

```ts
interface AdapterContext {
  app: Express                  // Express application instance
  container: Container          // DI container
  server?: http.Server          // populated only inside afterStart
  env: string                   // NODE_ENV (default 'development')
  isProduction: boolean         // true when NODE_ENV === 'production'
}
```

No need to import Express or http types — destructure only what you use.

## Middleware Phases

The `middleware()` method returns entries that are inserted at a specific phase in the pipeline. Each entry has a `handler`, an optional `phase`, and an optional `path` for scoping:

```ts
interface AdapterMiddleware {
  handler: any
  phase?: 'beforeGlobal' | 'afterGlobal' | 'beforeRoutes' | 'afterRoutes'
  path?: string
}
```

| Phase          | When it runs                                            |
| -------------- | ------------------------------------------------------- |
| `beforeGlobal` | Before any user-defined global middleware               |
| `afterGlobal`  | After global middleware, before module routes (default) |
| `beforeRoutes` | Just before module routes are mounted                   |
| `afterRoutes`  | After module routes, before error handlers              |

## Application Setup Pipeline

The `Application.setup()` method executes these steps in order:

1. **Adapter `beforeMount` hooks** -- mount early routes (health, docs UI)
2. **Hardened defaults** -- disable `x-powered-by`, set `trust proxy`
3. **Adapter middleware: `beforeGlobal`**
4. **Global middleware** -- user-declared pipeline or defaults (`requestId`, `express.json`)
5. **Adapter middleware: `afterGlobal`**
6. **Module registration + DI bootstrap**
7. **Adapter middleware: `beforeRoutes`**
8. **Module route mounting** -- versioned at `/{prefix}/v{version}/{path}`
9. **Adapter middleware: `afterRoutes`**
10. **Error handlers** -- notFound + global error handler
11. **Adapter `beforeStart` hooks**

After setup, when the HTTP server starts listening, `afterStart` is called. On shutdown, all adapter `shutdown` methods run concurrently via `Promise.allSettled` -- one failure does not block others.

## Writing a Custom Adapter

### Health Check Adapter

Register routes that bypass the global middleware stack:

```ts
import { defineAdapter, type AdapterContext, type AdapterMiddleware } from '@forinda/kickjs'

export const HealthAdapter = defineAdapter({
  name: 'HealthAdapter',
  build: () => ({
    beforeMount({ app }: AdapterContext): void {
      app.get('/health', (_req, res) => {
        res.json({
          status: 'ok',
          timestamp: new Date().toISOString(),
          uptime: process.uptime(),
        })
      })
    },

    middleware(): AdapterMiddleware[] {
      return [
        {
          phase: 'beforeGlobal',
          handler: (_req, res, next) => {
            res.setHeader('X-Powered-By', 'KickJS')
            next()
          },
        },
      ]
    },
  }),
})
```

### Rate Limit Adapter

Scope middleware to specific paths using the `path` property:

```ts
import { defineAdapter, type AdapterMiddleware } from '@forinda/kickjs'

export const RateLimitAdapter = defineAdapter({
  name: 'RateLimitAdapter',
  build: () => ({
    middleware(): AdapterMiddleware[] {
      return [
        { path: '/api/v1/auth', handler: rateLimit({ max: 10 }), phase: 'beforeRoutes' },
        { handler: rateLimit({ max: 200 }), phase: 'beforeRoutes' },
      ]
    },
  }),
})
```

### Redis Adapter with Shutdown

Connect on start, clean up on shutdown — note how `build()` owns the
client reference, so each instance of the adapter has its own
connection (and `shutdown` closes the right one):

```ts
import { createToken, defineAdapter, type AdapterContext } from '@forinda/kickjs'
import { createClient, type RedisClientType } from 'redis'

// Typed DI token — `container.resolve(REDIS)` returns RedisClientType.
export const REDIS = createToken<RedisClientType>('kick/redis/client')

export const RedisAdapter = defineAdapter({
  name: 'RedisAdapter',
  build: () => {
    const client = createClient()

    return {
      async beforeStart({ container }: AdapterContext): Promise<void> {
        await client.connect()
        container.registerInstance(REDIS, client)
      },
      async shutdown(): Promise<void> {
        await client.quit()
      },
    }
  },
})
```

## Registering Adapters

Pass adapter instances to `bootstrap()` or `Application`:

```ts
import { bootstrap } from '@forinda/kickjs'
import { modules } from './modules'
import { HealthAdapter } from './adapters/health.adapter'
import { CorsAdapter } from './adapters/cors.adapter'

bootstrap({
  modules,
  adapters: [HealthAdapter(), CorsAdapter({ origin: '*' })],
})
```

## Route Metadata via onRouteMount

The `onRouteMount` hook is called for each module route that declares a `controller`. Use it to collect route metadata for OpenAPI generation or logging:

```ts
onRouteMount(controllerClass: any, mountPath: string): void {
  console.log(`Mounted ${controllerClass.name} at ${mountPath}`)
}
```
