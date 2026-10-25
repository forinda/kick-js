# Authorization

::: tip There is no built-in authorization layer
The framework ships **no roles system and no policy engine**. `@Roles`, `@Policy`, `@Can` and `AuthorizationService` belonged to `@forinda/kickjs-auth`, removed in **v8**, and have no first-party replacement by design. Authorization is **your code**: the sections below are the recommended shapes to compose from [context decorators](./context-decorators.md).
:::

::: tip Example
[`task-mongoose-api`](https://github.com/forinda/kickjs-examples-archive/tree/main/task-mongoose-api): workspace membership checked on every resource route, route flags and role checks. More in [Examples](../examples/index.md).
:::

::: tip Scaffold the pieces
The role check below is a contributor — `kick g contributor <name> --params "roles:string"` writes the parameterised form. For a check that must short-circuit the response, `kick g guard <name>` writes middleware instead.

<PmCommand exec="kick g contributor require-role --params &quot;roles:string&quot;" />

Full flag list: [Generators](./generators.md#kick-g-contributor).
:::

## BYO role checks — `@RequireRole` {#byo-role-checks}

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

Registered globally — `bootstrap({ contributors: [LoadAuthUser] })` — so every route has a resolved user before any role check runs. Every key a contributor sets is declared on `ContextMeta`, including the ones below; an undeclared `key` is a type error:

```ts
declare module '@forinda/kickjs' {
  interface ContextMeta {
    user: AuthUser | null
    roleCheck: true // @RequireRole
    authorized: true // @Can (below)
  }
}
```

With that in place:

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
// `dependsOn` keys are compile errors once `kick typegen` has run.
@RequireRole({ roles: ['admin', 'manager'] })
@Get('/dashboard')
dashboard(ctx: RequestContext) { /* ctx.get('user') is non-null here */ }
```

Because `roles` is your own `AuthUser` type, literal-union role names give you compile-time typo checking with zero augmentation machinery — you declared the type yourself in Step 1.

## Policies — bring your own engine via DI {#policies}

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

## Access rules as route flags {#flag-driven}

`@RequireRole` and `@Can` put a check on each route. The other way round: **declare** the rule on the route as [route flags](./route-flags.md), and let one contributor enforce every rule it finds. The rules become data — inherited from the class or the module mount, listed per route in DevTools' **Routes** tab, readable by Swagger — and the enforcement lives in one place.

```ts
// src/auth/flags.ts
import { defineRouteFlag } from '@forinda/kickjs'

export const Public = defineRouteFlag('auth.public')
export const Roles = defineRouteFlag<readonly string[]>('auth.roles') // any of these
export const Permissions = defineRouteFlag<readonly string[]>('auth.permissions') // all of these
export const Policy = defineRouteFlag<string>('auth.policy') // a named policy
```

`kick typegen` reads these calls, so `flags.get('auth.roles')` comes back as `readonly string[] | undefined` and a misspelt name is a compile error.

```ts
// src/auth/authorize.ts
import {
  createToken,
  defineHttpContextDecorator,
  HttpException,
  type RequestContext,
} from '@forinda/kickjs'
import type { AuthUser } from './context'

export type PolicyFn = (input: {
  user: AuthUser
  ctx: RequestContext
}) => boolean | Promise<boolean>
export const POLICIES = createToken<Readonly<Record<string, PolicyFn>>>('app/auth/policies')

declare module '@forinda/kickjs' {
  interface ContextMeta {
    user: AuthUser | null
    // What the check granted — services read it with getRequestValue('access').
    access: { roles: readonly string[]; permissions: readonly string[]; policy?: string }
  }
}

export const Authorize = defineHttpContextDecorator({
  key: 'access',
  dependsOn: ['user'],
  deps: { policies: POLICIES },
  resolve: async (ctx, { policies }) => {
    const flags = ctx.route!.flags // contributors run after the route is matched
    const roles = flags.get('auth.roles') ?? []
    const permissions = flags.get('auth.permissions') ?? []
    const policy = flags.get('auth.policy')

    if (roles.length || permissions.length || policy) {
      const user = ctx.get('user')
      if (!user) throw HttpException.unauthorized()
      if (roles.length && !roles.some((r) => user.roles.includes(r)))
        throw HttpException.forbidden()
      if (!permissions.every((p) => user.permissions.includes(p))) throw HttpException.forbidden()
      if (policy) {
        const check = policies[policy]
        if (!check)
          throw new Error(
            `No policy named '${policy}' (${ctx.route!.method} ${ctx.route!.pattern})`,
          )
        if (!(await check({ user, ctx }))) throw HttpException.forbidden()
      }
    }
    return { roles, permissions, policy }
  },
})
```

Register it once — `bootstrap({ contributors: [Authorize.registration] })`, or from your auth adapter's `contributors()` next to `LoadAuthUser` — and declare rules where they belong:

```ts
@Roles(['staff']) // every route below
@Controller()
export class ReportsController {
  @Get('/')
  list(ctx: RequestContext) {}

  @Roles(['admin']) // replaces ['staff'] here — see below
  @Permissions(['reports.delete'])
  @Policy('report.notArchived')
  @Delete('/:id')
  remove(ctx: RequestContext) {}

  @Roles.off // no role rule on this one
  @Get('/summary')
  summary(ctx: RequestContext) {}
}

// A whole module, without touching its controllers:
routes: () => ({ path: '/admin', controller: AdminController, flags: { 'auth.roles': ['admin'] } })
```

### What the contributor can read

`ctx.route` is the matched route, available in every contributor and `@Middleware()` guard:

| Field                       | Example                                     |
| --------------------------- | ------------------------------------------- |
| `flags`                     | `flags.get('auth.roles')`, `flags.has(...)` |
| `method`, `path`            | `DELETE`, `/:id` (as declared)              |
| `pattern`                   | `/api/v1/reports/:id` — for logs and audits |
| `controller`, `handlerName` | `ReportsController`, `remove`               |

So the check can name the route in an audit record, or read metadata of your own off `controller.prototype` and `handlerName` with `getMethodMeta()`. `skipWhen` / `onlyWhen` are optional: reading the flags inside `resolve()` is enough, as above. Add one when you'd rather the contributor not run at all on routes without rules — it takes a flag list or a callback over the same route data:

```ts
onlyWhen: ['auth.roles', 'auth.permissions', 'auth.policy'],
onlyWhen: ({ flags, route }) => flags.size > 0 || route?.path.startsWith('/admin') === true,
```

With `onlyWhen`, `access` is absent on unflagged routes — read it with `getRequestValue('access')`, not `ctx.require('access')`.

The route is on the request, not in the request store: a service reaches it only through what a contributor sets. That's what `access` above is for.

### One value per flag: precedence replaces

A flag holds one value, resolved **method > class > mount** — the higher site replaces the lower, it doesn't add to it. `@Roles(['staff'])` on the class and `@Roles(['admin'])` on a method means _admin_, not _staff and admin_. To require both, put them in different flags (a role and a permission), or in a policy:

```ts
const allOf =
  (...checks: PolicyFn[]): PolicyFn =>
  async (input) => {
    for (const check of checks) if (!(await check(input))) return false
    return true
  }
const hasRole =
  (role: string): PolicyFn =>
  ({ user }) =>
    user.roles.includes(role)

container.registerInstance(POLICIES, {
  'report.notArchived': async ({ ctx }) => !(await reports.isArchived(ctx.params.id)),
  'report.delete': allOf(hasRole('staff'), hasRole('auditor')),
})
```

Composition lives in code; the flag only names the policy.

### Failing closed

The flags do nothing until `Authorize` is registered, and a route with no flag has no rule. Pair it with a protected default — `LoadAuthUser` rejecting anonymous callers everywhere except `@Public` ([BYO Auth](./byo-recipes.md#auth)) — so a forgotten flag still means "signed in", never "open". The DevTools **Routes** tab lists every route's flags: check it for routes that should have a rule.

### Flags or parameterised contributors?

| Use                             | When                                                                         |
| ------------------------------- | ---------------------------------------------------------------------------- |
| Route flags + one `Authorize`   | Rules are data: roles, permissions, policy names; set per class or per mount |
| `@RequireRole` / `@Can` (above) | A one-off check, or one that needs the resource loaded first                 |
| A `@Middleware()` guard         | The check must run before validation, or short-circuit with a custom reply   |

They mix: a route can carry flags read by `Authorize` and a `@Can` that loads the resource.

Unit-test the contributor without HTTP by handing it a route: `runContributor(Authorize, { ctx: { route: { flags: new Map([['auth.roles', ['admin']]]) } }, initial: { user } })` — see [Testing Authentication](./testing/auth.md).

## Guards (Custom Middleware)

`kick g guard <name>` generates a middleware function for authorization logic that needs to **short-circuit the response** or run before route matching — the cases [context decorators deliberately don't cover](./context-decorators.md). For value-producing checks, prefer a contributor. The mechanics are in [Middleware → Guards](./middleware.md#guards); what follows is the authorization-specific shape.

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

### Exempting routes: flags, not path lists

A guard that must let some routes through should read a [route flag](./route-flags.md). `ctx.route` is populated for any `@Middleware()`, because it runs inside the matched route:

```ts
export async function ipWhitelistGuard(ctx: RequestContext, next: () => void) {
  if (ctx.route?.flags.has('ops.internal')) return next()
  // …check as above
}
```

The built-in `csrfGuard()` and `rateLimitGuard()` take `exemptWhen`, which accepts a flag name, `'!name'`, a single-polarity list, or a predicate:

```ts
@Middleware(rateLimitGuard({ max: 60, exemptWhen: 'auth.public' }))
@Controller()
export class ApiController {}
```

Prefer this to a pathname allow-list: a flag is declared on the route and survives an `apiPrefix` or version change that voids `/api/v1/...` strings.

**Global** middleware is the exception — it runs before a route is matched, so it has no `ctx.route`. `rateLimit()` mounted in `bootstrap()` reads flags from the route policy table instead; see [Route Flags → Middleware that runs before routing](./route-flags.md#middleware-that-runs-before-routing).

### When to Use What

| Mechanism                         | Use when                                                               | Example                                     |
| --------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------- |
| `@RequireRole('admin')` (yours)   | The user needs a string role                                           | Admin panel access                          |
| A policy resolved from DI (yours) | The check depends on the specific resource                             | "Can this user edit THIS post?"             |
| `@Middleware(guard)`              | Logic not tied to roles or resources, or that must short-circuit       | IP whitelist, feature flags, API versioning |
| A [route flag](./route-flags.md)  | Recording a fact about the route that several checks read              | `auth.public` on webhooks and health probes |
| [Access flags](#flag-driven)      | Declaring roles, permissions or a policy that one contributor enforces | `@Roles(['admin'])` on a module mount       |
| `rateLimit()`                     | Throttle specific endpoints                                            | Login endpoint, search API                  |

The first two are code you own — see [BYO role checks](#byo-role-checks) and [Policies](#policies) above. The framework ships the primitives they are built from, not the checks themselves.

**Ordering is yours to set.** There is no built-in auth middleware imposing a precedence any more, so the order is simply the order you register things:

1. Global middleware, in the order given to `bootstrap({ middlewares })` — no `ctx.route` yet
2. Validation (`{ body, query, params }`), then `@FileUpload`
3. `@Middleware()` guards — class-level, then method-level
4. Context contributors, topologically sorted by `dependsOn` — this is where the user is loaded, and where `skipWhen` lets a route flag opt out of loading one
5. The handler

::: warning A guard cannot read a contributor's value
Guards run at step 3, contributors at step 4, so `ctx.get('user')` inside a `@Middleware()` guard is `undefined` — on Express, Fastify and h3 alike. A role check that reads the user has to **be** a contributor that `dependsOn` the one loading it, and reject from there. See [Context Decorators](./context-decorators.md#ordering-with-dependson).

The same order is documented from the middleware side in [Middleware → Execution order](./middleware.md#execution-order).
:::

## See Also

- [Authentication](./authentication.md) — loading the user this page authorizes
- [BYO Auth recipe](./byo-recipes.md#auth) — the full walkthrough
- [Multi-Tenancy](/guide/multi-tenancy) — tenant-scoped role resolution
- [Middleware](/guide/middleware) — custom middleware and guards
