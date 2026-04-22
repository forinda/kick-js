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

Under the hood a plugin is any object that satisfies the `KickPlugin` interface — factories, classes, and inline literals all work. Here's the simplest possible plugin written by hand:

```ts
import type { KickPlugin } from '@forinda/kickjs'
import { cors } from '@forinda/kickjs'

export function corsPlugin(): KickPlugin {
  return {
    name: 'cors',
    middleware() {
      return [cors({ origin: '*' })]
    },
  }
}
```

Class-based plugins are equivalent and can still implement `KickPlugin` directly if you prefer that style:

```ts
import type { KickPlugin } from '@forinda/kickjs'

export class CorsPlugin implements KickPlugin {
  name = 'CorsPlugin'

  middleware() {
    return [cors({ origin: '*' })]
  }
}
```

## Plugin Interface

```ts
interface KickPlugin {
  name: string
  register?(container: Container): void
  modules?(): AppModuleClass[]
  adapters?(): AppAdapter[]
  middleware?(): any[]
  contributors?(): ContributorRegistration[]
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
import { defineContextDecorator, type KickPlugin } from '@forinda/kickjs'

const LoadFlags = defineContextDecorator({
  key: 'flags',
  resolve: (ctx) => fetchFlags(ctx.requestId!),
})

declare module '@forinda/kickjs' {
  interface ContextMeta {
    flags: { beta: boolean }
  }
}

export class FlagsPlugin implements KickPlugin {
  name = 'FlagsPlugin'
  contributors() {
    return [LoadFlags.registration]
  }
}
```

A plugin that bundles both an adapter and a direct contributor is fine — the adapter's `contributors?()` and the plugin's `contributors?()` both feed the same `'adapter'` precedence bucket. Use whichever is more natural for the bundle's shape.

## Usage

```ts
import { bootstrap } from '@forinda/kickjs'

bootstrap({
  modules,
  plugins: [
    new CorsPlugin(),
    new AuthPlugin({ secret: process.env.JWT_SECRET! }),
    new MonitoringPlugin({ service: 'my-api' }),
  ],
  adapters: [new SwaggerAdapter({ ... })],
})
```

Plugins run before user-defined modules, adapters, and middleware, so they can provide dependencies that user code relies on.

## Full Example: Auth Plugin

```ts
import {
  createToken,
  type KickPlugin,
  type Container,
  type AppModuleClass,
  type AppAdapter,
} from '@forinda/kickjs'
import passport from 'passport'

interface AuthConfig {
  secret: string
  expiresIn?: string
}

// Typed DI token — `container.resolve(AUTH_SERVICE)` returns AuthConfig
// without any manual generic.
export const AUTH_SERVICE = createToken<AuthConfig>('AuthService')

export class AuthPlugin implements KickPlugin {
  name = 'AuthPlugin'

  constructor(private config: AuthConfig) {}

  register(container: Container) {
    container.registerFactory(AUTH_SERVICE, () => ({
      secret: this.config.secret,
      expiresIn: this.config.expiresIn ?? '1h',
    }))
  }

  modules(): AppModuleClass[] {
    return [AuthModule] // provides /auth/login, /auth/register routes
  }

  middleware() {
    return [passport.initialize()]
  }

  onReady() {
    console.log('Auth plugin ready')
  }
}
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
