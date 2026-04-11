# Adapters

Adapters plug into the KickJS application lifecycle. Use them to add health checks, CORS, rate limiting, WebSocket support, database connections, Swagger docs, or any cross-cutting concern.

## The AppAdapter Interface

Every adapter implements part (or all) of the `AppAdapter` interface from `@forinda/kickjs`:

```ts
import type { AppAdapter, AdapterContext } from '@forinda/kickjs'

// AdapterContext — populated by the framework, passed to all hooks
interface AdapterContext {
  app: any // Express application instance
  container: Container // DI container
  server?: any // http.Server (only in afterStart)
  env: string // NODE_ENV (default: 'development')
  isProduction: boolean // true when NODE_ENV === 'production'
}

// AppAdapter — implement the hooks you need
interface AppAdapter {
  name?: string
  middleware?(): AdapterMiddleware[]
  beforeMount?(ctx: AdapterContext): void | Promise<void>
  onRouteMount?(controllerClass: any, mountPath: string): void
  beforeStart?(ctx: AdapterContext): void | Promise<void>
  afterStart?(ctx: AdapterContext): void | Promise<void>
  shutdown?(): void | Promise<void>
}
```

All hooks receive an `AdapterContext` — no need to import Express or http types. Destructure only what you need.

All methods are optional. Implement only what you need.

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
import type { AppAdapter, AdapterContext } from '@forinda/kickjs'

export class HealthAdapter implements AppAdapter {
  name = 'HealthAdapter'

  beforeMount({ app }: AdapterContext): void {
    app.get('/health', (_req, res) => {
      res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
      })
    })
  }

  middleware(): AdapterMiddleware[] {
    return [
      {
        phase: 'beforeGlobal',
        handler: (_req: any, res: any, next: any) => {
          res.setHeader('X-Powered-By', 'KickJS')
          next()
        },
      },
    ]
  }
}
```

### Rate Limit Adapter

Scope middleware to specific paths using the `path` property:

```ts
import type { AppAdapter, AdapterMiddleware } from '@forinda/kickjs'

export class RateLimitAdapter implements AppAdapter {
  name = 'RateLimitAdapter'

  middleware(): AdapterMiddleware[] {
    return [
      { path: '/api/v1/auth', handler: rateLimit({ max: 10 }), phase: 'beforeRoutes' },
      { handler: rateLimit({ max: 200 }), phase: 'beforeRoutes' },
    ]
  }
}
```

### Redis Adapter with Shutdown

Connect on start, clean up on shutdown:

```ts
import { createToken, type AppAdapter, type AdapterContext } from '@forinda/kickjs'
import { createClient, type RedisClientType } from 'redis'

// Typed DI token — `container.resolve(REDIS)` returns RedisClientType.
export const REDIS = createToken<RedisClientType>('Redis')

export class RedisAdapter implements AppAdapter {
  name = 'RedisAdapter'
  private client = createClient()

  async beforeStart({ container }: AdapterContext): Promise<void> {
    await this.client.connect()
    container.registerInstance(REDIS, this.client)
  }

  async shutdown(): Promise<void> {
    await this.client.quit()
  }
}
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
  adapters: [new HealthAdapter(), new CorsAdapter({ origin: '*' })],
})
```

## Route Metadata via onRouteMount

The `onRouteMount` hook is called for each module route that declares a `controller`. Use it to collect route metadata for OpenAPI generation or logging:

```ts
onRouteMount(controllerClass: any, mountPath: string): void {
  console.log(`Mounted ${controllerClass.name} at ${mountPath}`)
}
```
