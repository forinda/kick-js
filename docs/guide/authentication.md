# Authentication

::: tip Auth is bring-your-own
The framework ships **no authentication layer**. You compose `@LoadAuthUser` / `@RequireRole` / `@Public` from its own primitives — `defineContextDecorator` and `defineAdapter` — in roughly 200 lines you own end to end, so no framework upgrade can change your auth surface underneath you.

`@forinda/kickjs-auth` was removed in **v8**. It had been frozen since 6.0.1; the [BYO Auth recipe](./byo-recipes.md#auth) is the replacement and covers every decorator, strategy and adapter it shipped.
:::

## The BYO approach

Authentication is just **typed, ordered context population** — exactly what [context decorators](context-decorators.md) do. The full walkthrough lives in the [BYO Auth recipe](byo-recipes.md#auth); the shape:

```ts
// 1. Declare what `ctx.get('user')` returns — once, globally.
declare module '@forinda/kickjs' {
  interface ContextMeta {
    user: AuthUser | null
  }
}

// 2. A strategy is a function: ctx in, user-or-null out. You own the
//    credential handling (JWT verify, API-key lookup, session read).
export function jwtStrategy(opts: { secret: string }): AuthStrategy {
  /* … */
}

// 3. `@LoadAuthUser` is a parameterised contributor — resolves the user
//    before the handler runs, throws 401 unless `on401: 'allow'`.
//    Only the params shape is spelled; key + deps types are inferred.
export const LoadAuthUser = defineHttpContextDecorator.withParams<{
  on401: 'allow' | 'reject'
}>()({
  key: 'user',
  deps: { strategies: AUTH_STRATEGIES },
  skipWhen: 'auth.public', // ← routes flagged @Public never reach the resolver
  paramDefaults: { on401: 'reject' },
  resolve: async (ctx, { strategies }, params) => {
    /* try strategies in order */
  },
})

// 4. `@Public` is a route flag the contributor skips on. The flag is a fact
//    about the route; `skipWhen` on the contributor reads it (see below).
export const Public = defineRouteFlag('auth.public')

// 5. AuthAdapter (defineAdapter) registers the strategy list in DI and
//    ships LoadAuthUser as a GLOBAL contributor when defaultPolicy is
//    'protected' — every route requires a user unless marked @Public.
```

::: tip Why a flag rather than a permissive twin
`@Public` used to be `LoadAuthUser({ on401: 'allow' })` — a second instance of the same
contributor, registered at higher precedence. That works, and still does, but it only composes if
you own the contributor's key: you cannot exempt a contributor a plugin shipped, and no other
consumer (CSRF, rate limiting, the OpenAPI spec) can tell the route is public.

A [route flag](./route-flags.md) puts the fact on the route instead, so every consumer reads the
same declaration:

```ts
csrfGuard({ exemptWhen: 'csrf.exempt' })
rateLimitGuard({ max: 60, exemptWhen: 'auth.public' })
SwaggerAdapter({ bearerAuth: true, publicFlag: 'auth.public' })
```

Declared on a controller it covers every route below; `@Public.off` on one method opts that
route back in.
:::

Usage reads the same as the old package:

```ts
@Controller()
export class UsersController {
  @Public
  @Get('/health')
  health(ctx: RequestContext) {
    ctx.json({ ok: true })
  }

  @RequireRole({ roles: ['admin'] })
  @Delete('/:id')
  remove(ctx: RequestContext) {
    const actor = ctx.get('user') // typed AuthUser — never null here
    // …
  }
}
```

Follow the [recipe](byo-recipes.md#auth) for the complete, copy-paste-ready eight steps (strategies, role checks, adapter, bootstrap, migration checklist). Authorization patterns (roles, policies) live in [Authorization](authorization.md).

---

## See Also

- [BYO Auth recipe](./byo-recipes.md#auth) — the full walkthrough: strategies, the contributor, the adapter
- [Context Decorators](./context-decorators.md) — the primitive the recipe is built on
- [Authorization](./authorization.md) — role checks and policies on top of the user this page loads
