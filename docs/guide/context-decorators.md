# Context Decorators

Context decorators are a typed, ordered, declarative way to populate `ctx.set('key', value)` *before* a controller handler runs. They replace hand-written middleware whose only job is "compute X and stash it on the request".

```ts
@LoadTenant
@LoadProject  // depends on 'tenant' — runs after LoadTenant automatically
@Get('/projects/:id')
getProject(ctx: RequestContext) {
  ctx.get('tenant')   // typed via ContextMeta, guaranteed present
  ctx.get('project')  // typed via ContextMeta, guaranteed present
}
```

Compared to writing two custom middlewares for the same job, you get:

- **Type safety** — `ctx.get('tenant')` returns the type you declared in `ContextMeta`, not `any`.
- **Ordering enforced at startup** — declare `dependsOn` and the framework topo-sorts; cycles and missing dependencies fail boot, not requests.
- **DI integration** — the resolver receives a typed `deps` object resolved from the container.
- **Reusable across registration sites** — the same decorator works on a method, a class, a module, an adapter, or globally in `bootstrap()`.

## When to use

Use a context decorator when:

- The middleware's only output is a value other code reads off `ctx`.
- You want type safety on that value.
- The value depends on another value computed by an earlier middleware.

Stick with `@Middleware()` (or raw Express middleware) when:

- The handler short-circuits the response (`res.status(403).end()`).
- It manipulates the response stream (compression, body parsing).
- It runs before route matching (CORS, Helmet, request logging).

See [Middleware vs context decorators](./middleware.md#middleware-vs-context-decorators).

## Quickstart

```ts
import {
  defineContextDecorator,
  Controller,
  Get,
  type RequestContext,
} from '@forinda/kickjs'

// 1. Declare the value's type via ContextMeta augmentation
declare module '@forinda/kickjs' {
  interface ContextMeta {
    tenant: { id: string; name: string }
  }
}

// 2. Define the decorator with a resolver
const LoadTenant = defineContextDecorator({
  key: 'tenant',
  resolve: (ctx) => ({
    id: ctx.req.headers['x-tenant-id'] as string,
    name: 'Acme',
  }),
})

// 3. Apply it on a controller method (or class)
@Controller('/me')
class MeController {
  @LoadTenant
  @Get('/')
  me(ctx: RequestContext) {
    const tenant = ctx.get('tenant')   // typed: { id: string; name: string }
    return ctx.json({ tenant })
  }
}
```

That's the whole minimum surface. The rest of this guide covers DI deps, dependency ordering, error handling, the four registration sites beyond `@`-on-method, and how to author reusable decorators inside an adapter or plugin.

## Declaring dependencies (`deps`)

Resolvers can pull services out of the DI container. Declare them as a map; the runner resolves each token before calling `resolve()`:

```ts
import { createToken, defineContextDecorator } from '@forinda/kickjs'

export const TENANT_REPO = createToken<TenantRepository>('TenantRepository')

const LoadTenant = defineContextDecorator({
  key: 'tenant',
  deps: { repo: TENANT_REPO },
  resolve: async (ctx, { repo }) => {
    const id = ctx.req.headers['x-tenant-id'] as string
    return repo.findById(id)
  },
})
```

Dep values can be `InjectionToken<T>`s, class constructors, or string tokens — anything `container.resolve()` accepts. The argument shape passed to your resolver mirrors the `deps` object: `deps: { repo: TENANT_REPO }` produces `{ repo: TenantRepository }`.

If a token isn't registered when the runner tries to resolve it, the throw flows through the standard contributor [error matrix](#error-handling).

## Ordering with `dependsOn`

A contributor that needs another contributor's output declares the dependency by key:

```ts
const LoadProject = defineContextDecorator({
  key: 'project',
  dependsOn: ['tenant'],
  resolve: async (ctx) => {
    const tenant = ctx.get('tenant')!   // guaranteed present — the framework ran LoadTenant first
    return projectsRepo.findFor(tenant.id, ctx.params.id)
  },
})
```

The framework topologically sorts contributors at route mount time. Two failure modes:

- **Missing dependency.** A contributor declares `dependsOn: ['tenant']` but no other contributor produces `'tenant'` for the same route. The boot fails with `MissingContributorError` naming the dependent and the route.
- **Cycle.** Two contributors depend on each other (directly or transitively). Boot fails with `ContributorCycleError` reporting the cycle path.

Both errors are raised once during `app.setup()`, not per request. Bad pipelines fail fast.

## Error handling

When a `resolve()` throws, the runner consults two flags before deciding what to do:

| `resolve()` outcome | `optional` | `onError` defined | Behaviour |
|---|---|---|---|
| throws | `true` | — | skip the contributor; `ctx.get(key)` returns `undefined` |
| throws | `false` | yes | call `onError(err, ctx)`; returned value (if any) is stored under `key` |
| throws | `false` | no | propagate the original error to the Express error handler |
| `onError` throws | — | — | propagate the *new* error |
| `onError` returns `undefined` / `void` | — | — | skip; key remains unset |
| resolves | — | — | `ctx.set(key, value)` |

Examples:

```ts
// Best-effort: don't fail the request if the upstream is down.
const LoadFlags = defineContextDecorator({
  key: 'flags',
  optional: true,
  resolve: async () => flagsApi.fetchAll(),
})

// Recover with a cached value when the live fetch fails.
const LoadProfile = defineContextDecorator({
  key: 'profile',
  resolve: async (ctx) => liveProfileApi.get(ctx.user!.id),
  onError: async (_err, ctx) => cache.get(ctx.user!.id) ?? undefined,
})
```

`onError` may be async. Document that hooks run on the request hot path even though only on error — keep them short.

## Registration sites

A `defineContextDecorator(...)` call returns a function that works as both a decorator and a registration object. There are five places to attach it, in order of precedence (highest wins on key collision):

1. **Method decorator** — `@LoadX` on a controller method. Applies to that route only.
2. **Class decorator** — `@LoadX` on a controller class. Applies to every route on that controller.
3. **Module hook** — `AppModule.contributors?(): ContributorRegistration[]`. Applies to every route mounted by that module.
4. **Adapter hook** — `AppAdapter.contributors?(): ContributorRegistration[]`. Cross-cutting, applies to every route in the application.
5. **Bootstrap option** — `ApplicationOptions.contributors`. App-wide defaults, lowest precedence.

Same-precedence collisions on the same key throw `DuplicateContributorError` at boot. Cross-level collisions are silent overrides — the higher-precedence contributor wins.

```ts
// Method-level
class C {
  @LoadTenant
  @Get('/me')
  me(ctx: RequestContext) { /* ... */ }
}

// Class-level
@LoadTenant
class C { /* every method on C now sees `tenant` */ }

// Module-level
class TenantsModule implements AppModule {
  contributors() { return [LoadTenant.registration] }
  routes() { /* ... */ }
}

// Adapter-level
class TenantAdapter implements AppAdapter {
  name = 'TenantAdapter'
  contributors() { return [LoadTenant.registration] }
}

// Global (bootstrap)
bootstrap({
  modules,
  contributors: [LoadTenant.registration],
})
```

The `.registration` property on the returned function is the immutable `ContributorRegistration` the runner consumes. Decorator usage hides this; non-decorator usage exposes it.

## Authoring decorators in adapters and plugins

Plugin and adapter authors can ship reusable contributors that consumers opt into via the `contributors?()` hook:

```ts
import {
  defineContextDecorator,
  type AppAdapter,
  type ContributorRegistration,
} from '@forinda/kickjs'

const TENANT_HEADER = 'x-tenant-id'

const LoadTenantFromHeader = defineContextDecorator({
  key: 'tenant',
  resolve: (ctx) => ({
    id: ctx.req.headers[TENANT_HEADER] as string,
  }),
})

export class HeaderTenantAdapter implements AppAdapter {
  name = 'HeaderTenantAdapter'
  contributors(): ContributorRegistration[] {
    return [LoadTenantFromHeader.registration]
  }
}
```

Three considerations:

- **Augment `ContextMeta` in the adapter's types file** so consumers get `ctx.get('tenant')` typed automatically when they import the adapter:

  ```ts
  declare module '@forinda/kickjs' {
    interface ContextMeta {
      tenant: { id: string }
    }
  }
  ```

- **Use namespaced keys** for plugin-specific values to avoid collisions with app-defined keys: `'@my-plugin/state'` rather than `'state'`. Same convention as Pino fields and OpenTelemetry semantic conventions.

- **Document the override path.** Users can replace your adapter-level contributor with their own at the module, class, or method level — that's a feature, not a bug. Make it clear in the adapter README.

## Reading from services via `requestStore`

Services injected into contributors (or anywhere else inside the request) can read per-request state without holding a `ctx` reference. After Phase 3 of #107, `RequestContext` writes through the same `AsyncLocalStorage`-bound Map that the contributor pipeline uses:

```ts
import { Service, requestStore } from '@forinda/kickjs'

@Service()
class AuditService {
  log(action: string) {
    const store = requestStore.getStore()
    const tenantId = store?.values.get('tenant')?.id
    const userId = store?.values.get('user')?.id
    db.audit.insert({ action, tenantId, userId, requestId: store?.requestId })
  }
}
```

The store is `undefined` outside a request (background jobs, startup, tests without `requestScopeMiddleware()`). Always null-check before reading.

For unit-testing a contributor in isolation, see [`runContributor`](./testing.md) in the `@forinda/kickjs-testing` package.
