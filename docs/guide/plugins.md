# Plugin System

Plugins are the highest-level extension mechanism in KickJS. A single plugin can bundle modules, adapters, middleware, and DI bindings into one reusable unit.

::: tip Runtime plugins vs CLI plugins
This page covers **runtime plugins** — `definePlugin()` factories registered via `bootstrap({ plugins: [...] })` that contribute to the running HTTP app. They are distinct from **CLI plugins** (`defineCliPlugin()`), which extend the `kick` binary with new commands, generators, and typegens. See [CLI Plugins](./cli-plugins.md) for that surface. The two contracts share the "ship-as-a-plugin" philosophy but have different shapes and registration sites.
:::

## Why Plugins?

| Extension      | Scope                           | Use Case                                   |
| -------------- | ------------------------------- | ------------------------------------------ |
| **Middleware** | Single function in the pipeline | CORS, compression, logging                 |
| **Adapter**    | Lifecycle hooks + middleware    | Database, Swagger, DevTools                |
| **Module**     | Routes + DI bindings            | Feature modules (users, products)          |
| **Plugin**     | All of the above                | Auth system, admin panel, monitoring suite |

## Creating a Plugin

The fastest way is the generator:

```bash
kick g plugin analytics
# → src/plugins/analytics.plugin.ts
```

This scaffolds a factory function with every optional `KickPlugin` hook stubbed out and commented — uncomment the ones you need, delete the rest. The factory name is camelCased from the plugin name so it drops straight into `bootstrap({ plugins })`:

```ts
import { bootstrap } from '@forinda/kickjs'
import { analyticsPlugin } from './plugins/analytics.plugin'

export const app = await bootstrap({
  modules,
  plugins: [
    analyticsPlugin({
      /* options */
    }),
  ],
})
```

Under the hood every plugin is built with the `definePlugin()` factory — never `class Foo implements KickPlugin` or a plain function returning `KickPlugin`. The factory matches the `defineAdapter()` shape: `name`, optional `defaults`, and a `build(config, meta)` that returns the lifecycle object. Closures inside `build` give each plugin instance its own state.

Here's the simplest possible plugin written by hand:

```ts
import { cors, definePlugin } from '@forinda/kickjs'

export const CorsPlugin = definePlugin({
  name: 'CorsPlugin',
  build: () => ({
    middleware() {
      return [cors({ origin: '*' })]
    },
  }),
})
```

A parameterised plugin reads its own config in `build`:

```ts
import { definePlugin } from '@forinda/kickjs'

interface CorsPluginConfig {
  origin?: string | string[]
}

export const CorsPlugin = definePlugin<CorsPluginConfig>({
  name: 'CorsPlugin',
  defaults: { origin: '*' },
  build: (config) => ({
    middleware() {
      return [cors({ origin: config.origin })]
    },
  }),
})
```

### The `definePlugin` Options

| Option     | Type                                  | Notes                                                                                                   |
| ---------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `name`     | `string` (required)                   | Stable identity used for logging, `dependsOn` lookups, and `.scoped()` namespacing.                     |
| `version`  | `string`                              | Surfaced to DevTools and `kick add` compatibility checks.                                               |
| `requires` | `{ kickjs?: string }`                 | Peer-version ranges this plugin needs. Recorded as metadata today; runtime enforcement comes later.     |
| `defaults` | `Partial<TConfig>`                    | Merged under any caller overrides before `build` runs.                                                  |
| `build`    | `(config, ctx) => KickPluginInstance` | Returns the lifecycle object. The second arg is the [BuildContext](#buildcontext) — `{ name, scoped }`. |

### BuildContext

`build()` receives `(config, ctx)`. The `ctx` carries the resolved instance identity, which matters for [`.scoped()`](#multi-instance-plugins-scoped) plugins that namespace their DI tokens or resource keys:

```ts
definePlugin<{ url: string }>({
  name: 'CachePlugin',
  build: (config, { name, scoped }) => ({
    register(container) {
      // For `.scoped('users')` the name becomes 'CachePlugin:users' — use it
      // to derive unique DI tokens or log prefixes per instance.
      const token = createToken<RedisClient>(`cache/${name}`)
      container.registerInstance(token, new RedisClient(config.url))
    },
  }),
})
```

| Field    | Type      | Meaning                                                                                         |
| -------- | --------- | ----------------------------------------------------------------------------------------------- |
| `name`   | `string`  | Resolved instance name. Bare call: same as the definition `name`. `.scoped(s)`: `${name}:${s}`. |
| `scoped` | `boolean` | `true` when produced by `.scoped()`. Use to gate behaviour that only makes sense per-scope.     |

## Plugin Surface

`build()` returns any subset of these hooks. Every hook is optional — emit only what your plugin actually needs:

```ts
interface KickPluginInstance {
  name: string
  dependsOn?: readonly string[]
  register?(container: Container): void
  modules?(): AppModuleEntry[]
  setup?(registry: ModuleRegistry): void
  adapters?(): AppAdapter[]
  middleware?(): unknown[]
  contributors?(): ContributorRegistrations
  onReady?(container: Container): void | Promise<void>
  shutdown?(): void | Promise<void>
  introspect?(): unknown | Promise<unknown>
  devtoolsTabs?(): readonly unknown[]
}
```

| Method           | When it runs                   | Use Case                                                                                  |
| ---------------- | ------------------------------ | ----------------------------------------------------------------------------------------- |
| `dependsOn`      | Topo-sorted at boot            | Names of other plugins that must mount first — see [Ordering](#plugin-ordering-dependson) |
| `register()`     | Before modules load            | Bind services in DI                                                                       |
| `modules()`      | Before user modules (static)   | Add feature modules — array form, statically introspectable                               |
| `setup()`        | After `modules()`, before user | Conditionally `.mount(module)` based on captured config / env / runtime                   |
| `adapters()`     | Before user adapters           | Add lifecycle adapters                                                                    |
| `middleware()`   | Before user middleware         | Add global middleware                                                                     |
| `contributors()` | Per-route, at mount            | Ship typed [Context Contributors](./context-decorators.md) the plugin owns                |
| `onReady()`      | After server starts            | Post-startup tasks                                                                        |
| `shutdown()`     | On SIGINT/SIGTERM              | Cleanup resources                                                                         |
| `introspect()`   | DevTools poll                  | Snapshot of plugin state for the DevTools dashboard (counters, flags, tokens)             |
| `devtoolsTabs()` | DevTools mount                 | Plugin-owned tabs rendered inside the DevTools UI                                         |

### `modules()` vs `setup()`

Both register modules with the application. `modules()` returns an array — static, easy to introspect, suitable for plugins that always contribute the same fixed set. `setup(registry)` receives an imperative registry and lets the plugin decide what to mount based on config:

```ts
definePlugin<{ tenants: string[] }>({
  name: 'MultiTenantPlugin',
  defaults: { tenants: [] },
  build: (config) => ({
    setup(registry) {
      for (const tenant of config.tenants) {
        registry.mount(TenantModule.scoped(tenant, { id: tenant }))
      }
    },
  }),
})
```

Plugins can implement both — `modules()` runs first, then `setup()` adds to the same registry. Order across the framework: plugin `modules()` arrays → plugin `setup()` calls (in plugin dependsOn order) → user `bootstrap({ modules: [...] })` array → user `bootstrap({ setup })` callback.

> The registry currently exposes only `.mount(module)`. A future `.use(module)` for non-HTTP modules (queues, cron, workers) is planned but not yet implemented.

### Plugin Contributors

Plugins can ship [Context Contributors](./context-decorators.md) directly without standing up an accompanying adapter. Returned contributors merge into the per-route pipeline at the **`'adapter'` precedence level** — they win over global (bootstrap) contributors but lose to module / class / method ones with the same key.

```ts
import { definePlugin, defineHttpContextDecorator } from '@forinda/kickjs'

const LoadFlags = defineHttpContextDecorator({
  key: 'flags',
  resolve: (ctx) => fetchFlags(ctx.requestId!),
})

declare module '@forinda/kickjs' {
  interface ContextMeta {
    flags: { beta: boolean }
  }
}

export const FlagsPlugin = definePlugin({
  name: 'FlagsPlugin',
  build: () => ({
    contributors: () => [LoadFlags.registration],
  }),
})
```

A plugin that bundles both an adapter and a direct contributor is fine — the adapter's `contributors?()` and the plugin's `contributors?()` both feed the same `'adapter'` precedence bucket. Use whichever is more natural for the bundle's shape.

## The PluginFactory Surface

The value returned by `definePlugin()` is a `PluginFactory<TConfig>`. The bare call gives you a singleton; two helpers cover the multi-instance and async-config cases.

```ts
interface PluginFactory<TConfig> {
  (config?: Partial<TConfig>): KickPlugin
  scoped(scopeName: string, config?: Partial<TConfig>): KickPlugin
  async(opts: {
    inject?: readonly unknown[]
    useFactory(...deps: any[]): TConfig | Promise<TConfig>
  }): KickPlugin
  readonly definition: Readonly<DefinePluginOptions<TConfig>>
}
```

### Multi-Instance Plugins: `.scoped()`

The bare call (`AuthPlugin(config)`) produces a singleton whose runtime `name` matches the definition. `.scoped(scopeName, config)` produces a separate instance whose `name` becomes `${definitionName}:${scopeName}` — perfect for plugins that legitimately need to mount more than once.

```ts
const CachePlugin = definePlugin<{ url: string; ttl?: number }>({
  name: 'CachePlugin',
  defaults: { ttl: 60_000 },
  build: (config, { name }) => ({
    register(container) {
      container.registerInstance(createToken(`cache/${name}`), new RedisClient(config.url))
    },
  }),
})

bootstrap({
  modules,
  plugins: [
    CachePlugin.scoped('users', { url: process.env.REDIS_USERS_URL! }), // name = 'CachePlugin:users'
    CachePlugin.scoped('sessions', { url: process.env.REDIS_SESSIONS_URL! }), // name = 'CachePlugin:sessions'
  ],
})
```

Each scoped instance gets its own `BuildContext` (`scoped: true`, namespaced `name`) so it can derive unique DI tokens, log prefixes, or resource keys without clashing. The bare call still works — `CachePlugin({ url: '...' })` is equivalent to `CachePlugin.scoped('', ...)` minus the suffix.

### Deferred Config: `.async()`

When the config a plugin needs has to be resolved from the DI container itself (e.g. it depends on `ConfigService`, a database pool, or another plugin's registration), use `.async()`. It defers the entire build until the container is ready:

```ts
const AnalyticsPlugin = definePlugin<{ endpoint: string; apiKey: string }>({
  name: 'AnalyticsPlugin',
  build: (config) => ({
    register(container) {
      container.registerInstance(ANALYTICS, new AnalyticsClient(config))
    },
  }),
})

bootstrap({
  modules,
  plugins: [
    AnalyticsPlugin.async({
      inject: [CONFIG_SERVICE],
      useFactory: (config: ConfigService) => ({
        endpoint: config.get('ANALYTICS_ENDPOINT'),
        apiKey: config.get('ANALYTICS_API_KEY'),
      }),
    }),
  ],
})
```

::: warning Async plugins skip early hooks
`.async()` resolves the config lazily inside `onReady`, so anything the plugin would contribute via `modules()`, `setup()`, `adapters()`, `middleware()`, or `contributors()` is **not registered** — those hooks have already run by the time the inner plugin is built. `register()` and `onReady()` fire late but do run. Use the bare call or `.scoped()` for plugins that need to add modules or middleware; reserve `.async()` for DI-only contributions whose config truly cannot be known at boot.
:::

### Introspecting a Factory: `.definition`

Every `PluginFactory` carries a read-only, frozen copy of the options you passed to `definePlugin()`. Its type is `Readonly<DefinePluginOptions<TConfig>>` — same five fields you originally supplied:

```ts
factory.definition = {
  readonly name: string
  readonly version?: string
  readonly requires?: { kickjs?: string }
  readonly defaults?: Partial<TConfig>
  readonly build: (config, ctx) => Omit<KickPlugin, 'name'>
}
```

For example, given:

```ts
export const AuthPlugin = definePlugin<{ secret: string; expiresIn?: string }>({
  name: 'AuthPlugin',
  version: '1.2.0',
  defaults: { expiresIn: '1h' },
  build: (config) => ({
    /* ... */
  }),
})

console.log(AuthPlugin.definition.name) // 'AuthPlugin'
console.log(AuthPlugin.definition.version) // '1.2.0'
console.log(AuthPlugin.definition.defaults) // { expiresIn: '1h' }
```

The snapshot is `Object.freeze`'d — assigning to any field throws in strict mode. Use it for:

**1. DevTools introspection.** The DevTools dashboard reads `definition.name` and `definition.version` to label plugins and check for available upgrades.

**2. Compatibility checks at boot.** Verify a peer plugin advertises a minimum version before mounting it:

```ts
if (compare(AuthPlugin.definition.version ?? '0.0.0', '1.2.0') < 0) {
  throw new Error('AuthPlugin >= 1.2.0 required for refresh-token support')
}
```

**3. Deriving a sibling factory.** Build a preconfigured variant of an existing plugin without re-defining its `build`:

```ts
export const AdminAuthPlugin = definePlugin({
  ...AuthPlugin.definition,
  name: 'AdminAuthPlugin',
  defaults: { ...AuthPlugin.definition.defaults, expiresIn: '15m' },
})
```

`.definition` is **metadata only** — it does not produce a mountable plugin. To mount, call the factory: `AuthPlugin()`, `AuthPlugin.scoped(...)`, or `AuthPlugin.async(...)`.

## Plugin Ordering: `dependsOn`

Plugins without `dependsOn` mount in declaration order — the order they appear in `bootstrap({ plugins: [...] })`. When one plugin needs another to have run first (e.g. a request-logger plugin that reads trace IDs an OTel plugin sets up), declare it:

```ts
const RequestLogger = definePlugin({
  name: 'RequestLoggerPlugin',
  build: () => ({
    dependsOn: ['OtelPlugin'],
    middleware() {
      return [
        /* reads otel trace id */
      ]
    },
  }),
})
```

The framework topologically sorts plugins at boot. Cycles throw `MountCycleError`; unknown names throw `MissingMountDepError` — both at boot, never at request time. With the `KickJsPluginRegistry` typegen pass (`kick typegen`), `dependsOn` is typed as a string-literal union of the project's actual plugin names instead of bare `string`.

## Usage

```ts
import { bootstrap } from '@forinda/kickjs'

bootstrap({
  modules,
  plugins: [
    CorsPlugin(),
    AuthPlugin({ secret: process.env.JWT_SECRET! }),
    MonitoringPlugin({ service: 'my-api' }),
  ],
  adapters: [SwaggerAdapter({ ... })],
})
```

Plugins are factories — call them with their config to get a plugin instance. They run before user-defined modules, adapters, and middleware, so they can provide dependencies that user code relies on.

## Full Example: Auth Plugin

```ts
import {
  createToken,
  definePlugin,
  type AppAdapter,
  type AppModuleEntry,
  type Container,
} from '@forinda/kickjs'
import passport from 'passport'

interface AuthPluginConfig {
  secret: string
  expiresIn?: string
}

// Typed DI token — `container.resolve(AUTH_SERVICE)` returns the resolved config
// without any manual generic.
export const AUTH_SERVICE = createToken<AuthPluginConfig>('kick/auth/service')

export const AuthPlugin = definePlugin<AuthPluginConfig>({
  name: 'AuthPlugin',
  defaults: { expiresIn: '1h' },
  build: (config) => ({
    register(container: Container) {
      container.registerFactory(AUTH_SERVICE, () => ({
        secret: config.secret,
        expiresIn: config.expiresIn ?? '1h',
      }))
    },

    modules(): AppModuleEntry[] {
      return [AuthModule] // provides /auth/login, /auth/register routes
    },

    middleware() {
      return [passport.initialize()]
    },

    onReady() {
      console.log('Auth plugin ready')
    },
  }),
})
```

## Inline Plugins for DI Bindings

For one-off DI bindings — things like binding a `VECTOR_STORE` token to a specific backend, or registering a connection pool a service depends on — you don't need to create a dedicated file. Inline plugin literals work everywhere a generated plugin does:

```ts
import { bootstrap } from '@forinda/kickjs'
import { AiAdapter, QdrantVectorStore, VECTOR_STORE } from '@forinda/kickjs-ai'

const store = new QdrantVectorStore({
  url: getEnv('QDRANT_URL'),
  collection: 'docs',
  dimensions: 1536,
})

export const app = await bootstrap({
  modules,
  adapters: [AiAdapter({ provider })],
  plugins: [
    {
      name: 'vector-store',
      register(container) {
        container.registerInstance(VECTOR_STORE, store)
      },
    },
  ],
})
```

The inline form is the canonical answer whenever you see docs that say "bind X in the container" — there is no top-level `register:` option on `bootstrap`, so DI wiring always flows through a plugin's `register(container)` hook.

Promote an inline plugin to a generated file as soon as it grows beyond two or three lines, or the moment you want to share it across apps.

## Execution Order

1. Plugin `register()` — DI bindings
2. Plugin `middleware()` — global middleware
3. Plugin `modules()` + user modules — route registration
4. Plugin `adapters()` + user adapters — lifecycle hooks
5. Server starts
6. Plugin `onReady()` — post-startup

## Related

- [Adapters](./adapters.md) — lifecycle hooks for databases, Swagger, etc.
- [Custom Decorators](./custom-decorators.md) — extend the decorator system
- [`definePlugin` API reference](../api/core.md#plugins) — full type signatures for `PluginFactory`, `KickPlugin`, `BuildContext`
- [DI Container](../api/core.md) — the dependency injection system
