# Authorization

::: tip There is no built-in authorization layer
The framework ships **no roles system and no policy engine**. `@Roles`, `@Policy`, `@Can` and `AuthorizationService` belonged to `@forinda/kickjs-auth`, removed in **v8**, and have no first-party replacement by design. Authorization is **your code**: the sections below are the recommended shapes to compose from [context decorators](./context-decorators.md).
:::

## BYO role checks — `@RequireRole`

A role check is a contributor that depends on the auth user and throws 401/403.

**It depends on a `user` contributor that this page does not define.** That one is the authentication half — it reads the credential, resolves the user, and puts it on the context under the key `user`. In full it is Step 3 of the [BYO Auth recipe](./byo-recipes.md#auth); the shape the check below relies on is:

```ts
// src/auth/context-decorators.ts — the producer of `ctx.get('user')`
export const LoadAuthUser = defineContextDecorator({
  key: 'user', //  ← the key `dependsOn: ['user']` refers to
  deps: { auth: AUTH_SERVICE },
  resolve: async (ctx, { auth }) => auth.authenticate(ctx), // AuthUser | null
})
```

Registered globally — `bootstrap({ contributors: [LoadAuthUser] })` — so every route has a resolved user before any role check runs. With that in place:

```ts
export const RequireRole = defineHttpContextDecorator.withParams<{
  roles: readonly string[]
  mode?: 'all' | 'any'
}>()({
  key: 'roleCheck',
  dependsOn: ['user'], // strict ordering — LoadAuthUser above resolves first
  paramDefaults: { roles: [], mode: 'any' },
  resolve: (ctx, _deps, params) => {
    const user = ctx.get('user')
    if (!user) throw withStatus(new Error('Unauthorized'), 401)
    const owned = new Set(user.roles)
    const hits = params.roles.filter((r) => owned.has(r))
    const ok = params.mode === 'all' ? hits.length === params.roles.length : hits.length > 0
    if (!ok) throw withStatus(new Error('Forbidden'), 403)
    return true
  },
})

// Usage — params are typed, ordering is topological, typos in
// `dependsOn` keys are caught by `kick typegen`'s ContextKeys registry.
@RequireRole({ roles: ['admin', 'manager'] })
@Get('/dashboard')
dashboard(ctx: RequestContext) { /* ctx.get('user') is non-null here */ }
```

Because `roles` is your own `AuthUser` type, literal-union role names give you compile-time typo checking with zero augmentation machinery — you declared the type yourself in Step 1.

## Policies — bring your own engine via DI

There is no first-party `@Policy` / `@Can` to migrate to — but nothing about a policy engine needs framework support. Context decorators have everything required to compose one: **`deps` injects any DI token** (your engine service), **`dependsOn` orders it after `user`**, and **parameterised decorators carry the action**. The engine is just a service you register:

```ts
// 1. Your engine — any shape you want. Registered in DI like any service.
export interface PolicyEngine {
  can(user: AuthUser, action: string, resource: unknown): boolean | Promise<boolean>
}
export const POLICY_ENGINE = createToken<PolicyEngine>('app/auth/policyEngine')

// 2. `@Can` is a parameterised contributor: engine via deps (DI), user
//    via dependsOn ordering, action via params. Only the params shape
//    is spelled — `key` and the deps types are inferred from the spec.
export const Can = defineHttpContextDecorator.withParams<{ action: string }>()({
  key: 'authorized',
  dependsOn: ['user'], // topologically ordered — user resolves first
  deps: { engine: POLICY_ENGINE, posts: POSTS_REPO },
  paramDefaults: { action: 'read' },
  resolve: async (ctx, { engine, posts }, params) => {
    const user = ctx.get('user')
    if (!user) throw withStatus(new Error('Unauthorized'), 401)
    const resource = await posts.findById(ctx.params.id)
    if (!resource) throw withStatus(new Error('Not Found'), 404)
    if (!(await engine.can(user, params.action, resource))) {
      throw withStatus(new Error('Forbidden'), 403)
    }
    return true
  },
})

// Usage — same ergonomics the old @Can had, but the engine is yours:
@Can({ action: 'post.delete' })
@Delete('/:id')
remove(ctx: RequestContext) { /* … */ }
```

Swap the engine implementation (CASL, a rules table, hardcoded checks) by re-binding `POLICY_ENGINE` — controllers never change. For simpler cases, fold the load-and-authorize into one contributor that returns the resource itself (`key: 'post'`), so the handler reads `ctx.get('post')` already authorized.

---

## Guards (Custom Middleware)

`kick g guard <name>` generates a middleware function for authorization logic that needs to short-circuit the response or run before route matching — the cases [context decorators deliberately don't cover](context-decorators.md). For value-producing checks, prefer a contributor; reach for a guard when you need raw Express middleware semantics.

<PmCommand exec="kick g guard ip-whitelist" />

```ts
// src/guards/ip-whitelist.guard.ts
export async function ipWhitelistGuard(ctx: RequestContext, next: () => void) {
  const allowed = ['10.0.0.0/8', '192.168.1.0/24']
  // `ctx.ip` works on every runtime. (`ctx.req.ip` is Express-only.)
  if (!allowed.some((range) => isInSubnet(ctx.ip ?? '', range))) {
    // `ctx.res` is the ENGINE-NATIVE response — `.json()` is Express-only
    // (FastifyReply has no `.json()`, h3's event has no `.status()`).
    ctx.problem.forbidden({ detail: 'IP not allowed' })
    return
  }
  next()
}
```

Apply it with `@Middleware()`:

```ts
import { Middleware } from '@forinda/kickjs'
import { ipWhitelistGuard } from '../guards/ip-whitelist.guard'

@Controller()
@Middleware(ipWhitelistGuard)
class InternalController {
  @Get('/metrics')
  metrics(ctx) { ... }
}
```

### When to Use What

| Mechanism                         | Use when                                                         | Example                                     |
| --------------------------------- | ---------------------------------------------------------------- | ------------------------------------------- |
| `@RequireRole('admin')` (yours)   | The user needs a string role                                     | Admin panel access                          |
| A policy resolved from DI (yours) | The check depends on the specific resource                       | "Can this user edit THIS post?"             |
| `@Middleware(guard)`              | Logic not tied to roles or resources, or that must short-circuit | IP whitelist, feature flags, API versioning |
| `rateLimit()`                     | Throttle specific endpoints                                      | Login endpoint, search API                  |

The first two are code you own — see [BYO role checks](#byo-role-checks-requirerole) and [Policies](#policies-bring-your-own-engine-via-di) above. The framework ships the primitives they are built from, not the checks themselves.

**Ordering is yours to set.** There is no built-in auth middleware imposing a precedence any more, so the order is simply the order you register things:

1. Global middleware, in the order given to `bootstrap({ middlewares })`
2. Context contributors, topologically sorted by `dependsOn` — this is where the user is loaded
3. `@Middleware()` guards, class-level then method-level
4. The handler

A role check that reads `ctx.get('user')` therefore has to run as a contributor that `dependsOn` the one loading the user, or as a guard mounted after it. See [Context Decorators](./context-decorators.md#ordering).

## See Also

- [Authentication](./authentication.md) — loading the user this page authorizes
- [BYO Auth recipe](./byo-recipes.md#auth) — the full walkthrough
- [Multi-Tenancy](/guide/multi-tenancy) — tenant-scoped role resolution
- [Middleware](/guide/middleware) — custom middleware and guards
