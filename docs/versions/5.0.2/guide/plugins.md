# Plugin System

Plugins are the highest-level extension mechanism in KickJS. A single plugin can bundle modules, adapters, middleware, and DI bindings into one reusable unit.

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
  plugins: [analyticsPlugin({ /* options */ })],
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

## Plugin Surface

`build()` returns any subset of these hooks. Every hook is optional — emit only what your plugin actually needs:

```ts
interface KickPluginInstance {
  name: string
  register?(container: Container): void
  modules?(): AppModuleClass[]
  adapters?(): AppAdapter[]
  middleware?(): unknown[]
  contributors?(): ContributorRegistrations
  onReady?(container: Container): void | Promise<void>
  shutdown?(): void | Promise<void>
}
```

| Method           | When it runs           | Use Case                                          |
| ---------------- | ---------------------- | ------------------------------------------------- |
| `register()`     | Before modules load    | Bind services in DI                               |
| `modules()`      | Before user modules    | Add feature modules                               |
| `adapters()`     | Before user adapters   | Add lifecycle adapters                            |
| `middleware()`   | Before user middleware | Add global middleware                             |
| `contributors()` | Per-route, at mount    | Ship typed [Context Contributors](./context-decorators.md) the plugin owns |
| `onReady()`      | After server starts    | Post-startup tasks                                |
| `shutdown()`     | On SIGINT/SIGTERM      | Cleanup resources                                 |

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
  type AppModuleClass,
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

    modules(): AppModuleClass[] {
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
- [DI Container](../api/core.md) — the dependency injection system
