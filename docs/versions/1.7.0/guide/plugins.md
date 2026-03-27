# Plugin System

Plugins are the highest-level extension mechanism in KickJS. A single plugin can bundle modules, adapters, middleware, and DI bindings into one reusable unit.

## Why Plugins?

| Extension | Scope | Use Case |
|-----------|-------|----------|
| **Middleware** | Single function in the pipeline | CORS, compression, logging |
| **Adapter** | Lifecycle hooks + middleware | Database, Swagger, DevTools |
| **Module** | Routes + DI bindings | Feature modules (users, products) |
| **Plugin** | All of the above | Auth system, admin panel, monitoring suite |

## Creating a Plugin

```ts
import type { KickPlugin } from '@forinda/kickjs-core'

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
  onReady?(container: Container): void | Promise<void>
  shutdown?(): void | Promise<void>
}
```

| Method | When it runs | Use Case |
|--------|-------------|----------|
| `register()` | Before modules load | Bind services in DI |
| `modules()` | Before user modules | Add feature modules |
| `adapters()` | Before user adapters | Add lifecycle adapters |
| `middleware()` | Before user middleware | Add global middleware |
| `onReady()` | After server starts | Post-startup tasks |
| `shutdown()` | On SIGINT/SIGTERM | Cleanup resources |

## Usage

```ts
import { bootstrap } from '@forinda/kickjs-http'

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
import type { KickPlugin, Container, AppModuleClass, AppAdapter } from '@forinda/kickjs-core'
import passport from 'passport'

export const AUTH_SERVICE = Symbol('AuthService')

interface AuthConfig {
  secret: string
  expiresIn?: string
}

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
    return [AuthModule]  // provides /auth/login, /auth/register routes
  }

  middleware() {
    return [passport.initialize()]
  }

  onReady() {
    console.log('Auth plugin ready')
  }
}
```

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
