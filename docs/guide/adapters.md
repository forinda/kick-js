# Adapters

Adapters plug into the KickJS application lifecycle. Use them to add health checks, CORS, rate limiting, WebSocket support, database connections, Swagger docs, or any cross-cutting concern.

## The `defineAdapter()` factory

v4 declares adapters with `defineAdapter({ name, defaults?, build })` — never `class Foo implements AppAdapter`.

::: tip `defineAdapter()` returns a factory, not an adapter
The value you `export` from `defineAdapter()` is an **`AdapterFactory<TConfig>`**, not an `AppAdapter`. Call the factory (`MyAdapter(config)`) to produce the mountable `AppAdapter` instance. `bootstrap({ adapters: [...] })` accepts the result of the call, never the factory itself.

```ts
export const MyAdapter = defineAdapter({ ... })   // AdapterFactory<TConfig>
bootstrap({ adapters: [MyAdapter()] })             // AppAdapter — invoked at the call site
bootstrap({ adapters: [MyAdapter] })               // ✗ type error — passed the factory
```

:::

The factory captures three things:

- `name` — string, used for diagnostics and the `KickJsPluginRegistry` typegen output. Required.
- `defaults?` — partial config the factory pre-applies before merging the caller's options. Optional.
- `build(config, ctx)` — runs once per adapter instance and returns the lifecycle object. Closures inside `build` are how each adapter instance owns its own state (Redis client, database pool, internal Map, etc.). The second arg is the `BuildContext` — `{ name, scoped }`, identical to `definePlugin`'s — useful for namespacing DI tokens in [`.scoped()`](#multi-instance-adapters-scoped) adapters.

`build()` returns the actual `AppAdapter` lifecycle object — any subset of the hooks below, every hook optional, plus optional extra methods (see [Extension methods (`TExtra`)](#extension-methods-textra)).

```ts
import { defineAdapter, type AdapterContext, type AdapterMiddleware } from '@forinda/kickjs'

interface MyAdapterConfig {
  apiKey?: string
}

export const MyAdapter = defineAdapter<MyAdapterConfig>({
  name: 'MyAdapter',
  defaults: {
    /* config defaults */
  },
  build: (config, { name }) => ({
    /** Express middleware entries to insert at named phases. */
    middleware(): AdapterMiddleware[] {
      return []
    },

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
    contributors() {
      return []
    },
  }),
})
```

`AdapterContext` (passed to every hook that takes it) is:

```ts
interface AdapterContext {
  app: Express // Express application instance
  container: Container // DI container
  server?: http.Server // populated only inside afterStart
  env: string // NODE_ENV (default 'development')
  isProduction: boolean // true when NODE_ENV === 'production'
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

## The AdapterFactory Surface

The value returned by `defineAdapter()` is an `AdapterFactory<TConfig, TExtra>`. The bare call produces a singleton; two helpers cover the multi-instance and async-config cases — identical shape to [`PluginFactory`](./plugins.md#the-pluginfactory-surface) so the mental model is shared.

```ts
interface AdapterFactory<TConfig, TExtra = unknown> {
  /** Singleton form — `RedisAdapter({ url })`. */
  (config?: Partial<TConfig>): AppAdapter & TExtra
  /** Multi-instance form — namespaces the resolved name to `${defName}:${scopeName}`. */
  scoped(scopeName: string, config?: Partial<TConfig>): AppAdapter & TExtra
  /** Deferred-config form — resolves DI tokens then calls `useFactory` inside `beforeStart`. */
  async(opts: AdapterAsyncOptions<TConfig>): AppAdapter
  /** Read-only access to the original definition. */
  readonly definition: Readonly<DefineAdapterOptions<TConfig, TExtra>>
}
```

### Default Mount: Just Call the Factory

**This is what 90% of apps need.** No `.scoped()`, no `.async()` — just invoke the factory once and put the result in `bootstrap({ adapters: [...] })`:

```ts
import { bootstrap } from '@forinda/kickjs'
import { modules } from './modules'
import { HealthAdapter } from './adapters/health.adapter'
import { CorsAdapter } from './adapters/cors.adapter'
import { RedisAdapter } from './adapters/redis.adapter'

bootstrap({
  modules,
  adapters: [
    HealthAdapter(), // no config needed
    CorsAdapter({ origin: '*' }), // pass config as the only argument
    RedisAdapter({ url: process.env.REDIS_URL! }),
  ],
})
```

Each bare call produces one singleton `AppAdapter` whose runtime `name` matches the definition (`'HealthAdapter'`, `'CorsAdapter'`, `'RedisAdapter'`). The adapter's `defaults` are merged under the config you pass — omit the argument entirely if all defaults are fine (`HealthAdapter()` above).

Mounting order in the array is mounting order at boot, unless an adapter declares [`dependsOn`](#ordering-with-dependson). Reach for `.scoped()` only when you need more than one instance of the same adapter; reach for `.async()` only when the config has to come from the DI container itself.

### Multi-Instance Adapters: `.scoped()`

The bare call produces a singleton whose runtime `name` matches the definition. `.scoped(scopeName, config)` produces a separate instance whose `name` becomes `${definitionName}:${scopeName}` — useful when one adapter type legitimately needs to mount more than once (sharded caches, per-region API clients):

```ts
const RedisAdapter = defineAdapter<{ url: string }>({
  name: 'RedisAdapter',
  build: (config, { name }) => {
    const client = createClient({ url: config.url })
    const token = createToken<RedisClientType>(`redis/${name}`)
    return {
      async beforeStart({ container }) {
        await client.connect()
        container.registerInstance(token, client)
      },
      async shutdown() {
        await client.quit()
      },
    }
  },
})

bootstrap({
  modules,
  adapters: [
    RedisAdapter.scoped('cache', { url: process.env.REDIS_CACHE_URL! }), // name = 'RedisAdapter:cache'
    RedisAdapter.scoped('sessions', { url: process.env.REDIS_SESSIONS_URL! }), // name = 'RedisAdapter:sessions'
  ],
})
```

### Deferred Config: `.async()`

When the config an adapter needs must be resolved from the DI container itself (e.g. it depends on `ConfigService` or another adapter's registration), use `.async()`. The inner adapter is built lazily inside `beforeStart`:

```ts
bootstrap({
  modules,
  adapters: [
    RedisAdapter.async({
      inject: [CONFIG_SERVICE],
      useFactory: (config: ConfigService) => ({ url: config.get('REDIS_URL') }),
    }),
  ],
})
```

::: warning `.async()` skips early adapter hooks
The async form resolves the config inside `beforeStart`, so anything the inner adapter would contribute via `middleware()`, `contributors()`, `beforeMount()`, or `onRouteMount()` is **not picked up** — those phases have already run. Only `beforeStart`, `afterStart`, `shutdown`, and `onHealthCheck` fire on the lazily-built inner adapter. Use the bare call or `.scoped()` when the adapter needs to contribute middleware or contributors.
:::

### Extension methods (`TExtra`)

If `build()` returns methods beyond the standard `AppAdapter` contract, the factory preserves them on the returned instance — so external callers (tests, peer adapters) can invoke them directly. The factory's `TExtra` generic is inferred from the build return type:

```ts
const OtelAdapter = defineAdapter({
  name: 'OtelAdapter',
  build: () => ({
    beforeStart({ container }) {
      /* ... */
    },
    // Extra method, not part of AppAdapter:
    applyRedaction(span: Span) {
      /* ... */
    },
  }),
})

const instance = OtelAdapter()
instance.applyRedaction(span) // typed and callable
```

### Introspecting a Factory: `.definition`

Every `AdapterFactory` carries a read-only, frozen copy of the options you passed to `defineAdapter()`. Its type is `Readonly<DefineAdapterOptions<TConfig, TExtra>>` — same five fields you originally supplied:

```ts
factory.definition = {
  readonly name: string
  readonly version?: string
  readonly requires?: { kickjs?: string }
  readonly defaults?: Partial<TConfig>
  readonly build: (config, ctx) => Omit<AppAdapter, 'name'> & TExtra
}
```

For example, given:

```ts
export const RedisAdapter = defineAdapter<{ url: string; ttl?: number }>({
  name: 'RedisAdapter',
  version: '1.2.0',
  defaults: { ttl: 60_000 },
  build: (config) => ({
    /* ... */
  }),
})

console.log(RedisAdapter.definition.name) // 'RedisAdapter'
console.log(RedisAdapter.definition.version) // '1.2.0'
console.log(RedisAdapter.definition.defaults) // { ttl: 60000 }
```

The snapshot is `Object.freeze`'d — assigning to any field throws in strict mode. Use it for:

**1. DevTools introspection.** The DevTools dashboard reads `definition.name` and `definition.version` to label adapters and check for available upgrades — no extra wiring needed.

**2. Compatibility checks at boot.** Verify that a third-party adapter you depend on advertises a minimum version before mounting it:

```ts
if (compare(RedisAdapter.definition.version ?? '0.0.0', '1.2.0') < 0) {
  throw new Error('RedisAdapter >= 1.2.0 required for TTL support')
}
```

**3. Deriving a sibling factory.** Build a preconfigured variant of an existing adapter without re-defining its `build`:

```ts
export const RedisCacheAdapter = defineAdapter({
  ...RedisAdapter.definition,
  name: 'RedisCacheAdapter',
  defaults: { ...RedisAdapter.definition.defaults, ttl: 5_000 },
})
```

`.definition` is **metadata only** — it does not produce a mountable adapter. To mount, call the factory: `RedisAdapter()`, `RedisAdapter.scoped(...)`, or `RedisAdapter.async(...)`.

## Ordering with `dependsOn`

Adapters mount in declaration order by default — whatever order they appear in the `adapters` array. When ordering matters across adapters (e.g. `OtelAdapter` must initialize tracing before `RequestLoggerAdapter` reads the trace ID), declare `dependsOn` on the `AppAdapter` returned from `build()` — same field, same topo-sort rules as plugins:

```ts
const RequestLogger = defineAdapter({
  name: 'RequestLoggerAdapter',
  build: () => ({
    dependsOn: ['OtelAdapter'],
    middleware() {
      /* reads otel trace id */ return []
    },
  }),
})
```

## Route Metadata via onRouteMount

The `onRouteMount` hook is called for each module route that declares a `controller`. Use it to collect route metadata for OpenAPI generation or logging:

```ts
onRouteMount(controllerClass: any, mountPath: string): void {
  console.log(`Mounted ${controllerClass.name} at ${mountPath}`)
}
```

## When to Reach for a Plugin Instead

An adapter is the right tool when the extension lives entirely in the request lifecycle — middleware, route metadata, health checks, before/after hooks. If you find yourself also bundling **modules**, **DI bindings**, or **context contributors** alongside an adapter, promote the whole thing to a [Plugin](./plugins.md). A plugin can ship adapters via its `adapters()` hook and still own the DI/module surface in one place; mount it via `bootstrap({ plugins: [...] })`.
