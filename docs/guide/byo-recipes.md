# BYO recipes

> "Bring-your-own" — domain primitives the framework deliberately
> doesn't ship as packages, with a working recipe so you own the
> surface end-to-end.

KickJS aims to ship **primitives**, not opinionated domain layers. A
domain layer (auth, multi-tenancy, audit, observability) tends to vary
project-to-project: different claim shapes, different session stores,
different policy rules. When the framework ships an opinionated
package for one of those domains, two things happen:

- Adopters with edge cases either fork the package or file feature
  requests that bloat its surface for everyone.
- Framework releases couple your auth (or whatever) cadence to ours —
  upgrading kickjs forces an auth surface review.

The fix is **BYO**: the framework ships the primitives
(`defineContextDecorator`, `defineAdapter`, `definePlugin`, the DI
container, the metadata helpers); each project composes the domain
layer it actually needs.

This doc collects working recipes for the domains we've moved to BYO.

## Deprecated packages → BYO targets

The current BYO targets, with a recipe for each:

- **`@forinda/kickjs-auth`** — see [Auth](#auth) below.
- **`@forinda/kickjs-multi-tenant`** — see [Multi-tenant](./multi-tenancy.md).
- **`@forinda/kickjs-otel`** — see [OpenTelemetry](./otel.md).
- **`@forinda/kickjs-notifications`** — see [Notifications](./notifications.md).
- **`@forinda/kickjs-mailer`** — see [Mailer](./mailer.md).
- **`@forinda/kickjs-cron`** — see [Cron](./cron.md).

The framework keeps shipping the **primitives** that those packages wrapped (`defineContextDecorator`, `defineAdapter`, `definePlugin`, the DI container, the metadata helpers) — see the [Context Decorators guide](./context-decorators.md) for the parameterised contributor primitive that drives most of the recipes here. Migrations are one-way and additive.

---

## Auth

The deprecated `@forinda/kickjs-auth` package shipped:

- Decorators: `@Authenticated`, `@Public`, `@Roles`, `@Can`, `@CsrfExempt`, `@RateLimit`, `@Policy`
- Adapter: `AuthAdapter({ strategies, defaultPolicy, onForbidden, … })`
- Strategies: `JwtStrategy`, `ApiKeyStrategy`, `OAuthStrategy`, `SessionStrategy`, `PassportBridge`

The recipe below composes the same surface from primitives. Each
adopter owns ~200 lines of auth code (decorators + service +
adapter); the framework owns only `defineContextDecorator` /
`defineAdapter` / DI.

### Step 1 — augment ContextMeta

```ts
// src/auth/context.ts
declare module '@forinda/kickjs' {
  interface ContextMeta {
    user: AuthUser | null
    permissions: ReadonlySet<string>
  }
}

export interface AuthUser {
  id: string
  email: string
  roles: readonly string[]
}
```

### Step 2 — auth strategies (your code, your shape)

A **strategy** is a function the auth contributor tries in order;
the first one that returns a user wins. Define one per credential
type:

```ts
// src/auth/strategies.ts
import jwt from 'jsonwebtoken'
import type { RequestContext } from '@forinda/kickjs'
import type { AuthUser } from './context'

export interface AuthStrategy {
  name: string
  validate(ctx: RequestContext): Promise<AuthUser | null> | AuthUser | null
}

// JWT strategy — adopter owns the secret + claim mapping.
export function jwtStrategy(opts: {
  secret: string
  mapPayload: (payload: jwt.JwtPayload) => AuthUser
}): AuthStrategy {
  return {
    name: 'jwt',
    validate: (ctx) => {
      const auth = ctx.req.headers.authorization
      if (!auth?.startsWith('Bearer ')) return null
      try {
        const payload = jwt.verify(auth.slice(7), opts.secret) as jwt.JwtPayload
        return opts.mapPayload(payload)
      } catch {
        return null
      }
    },
  }
}

// API-key strategy — adopter owns the key map + lookup logic.
export function apiKeyStrategy(opts: {
  keys: Record<string, AuthUser>
  header?: string
}): AuthStrategy {
  const header = opts.header ?? 'x-api-key'
  return {
    name: 'api-key',
    validate: (ctx) => opts.keys[ctx.req.headers[header] as string] ?? null,
  }
}
```

### Step 3 — `@LoadAuthUser` parameterised contributor

```ts
// src/auth/load-auth-user.ts
import { createToken, defineHttpContextDecorator } from '@forinda/kickjs'
import type { AuthStrategy } from './strategies'
import type { AuthUser } from './context'

export const AUTH_STRATEGIES = createToken<readonly AuthStrategy[]>('app/auth/strategies')

type LoadAuthUserParams = {
  /**
   * What to do when no strategy returns a user.
   * - `'allow'`: pass through with `user: null` (public route)
   * - `'reject'`: throw → 401
   *
   * Default `'reject'`.
   */
  on401: 'allow' | 'reject'
}

export const LoadAuthUser = defineHttpContextDecorator.withParams<LoadAuthUserParams>()({
  key: 'user',
  deps: { strategies: AUTH_STRATEGIES },
  paramDefaults: { on401: 'reject' },
  resolve: async (ctx, { strategies }, params) => {
    for (const strategy of strategies) {
      const user = await strategy.validate(ctx)
      if (user) return user
    }
    if (params.on401 === 'allow') return null
    const err = new Error('Unauthorized')
    ;(err as Error & { status: number }).status = 401
    throw err
  },
})
```

### Step 4 — `@RequireRole` parameterised contributor

```ts
// src/auth/require-role.ts
import { defineHttpContextDecorator } from '@forinda/kickjs'

type RequireRoleParams = { roles: readonly string[]; mode?: 'all' | 'any' }

export const RequireRole = defineHttpContextDecorator.withParams<RequireRoleParams>()({
  key: 'roleCheck',
  // Strict precedence — auth user must resolve before we check roles.
  dependsOn: ['user'],
  paramDefaults: { roles: [], mode: 'any' },
  resolve: (ctx, _deps, params) => {
    const user = ctx.get('user')
    if (!user) {
      const err = new Error('Unauthorized')
      ;(err as Error & { status: number }).status = 401
      throw err
    }
    const userRoles = new Set(user.roles)
    const required = params.roles
    const matches = required.filter((r) => userRoles.has(r))
    const ok = params.mode === 'all' ? matches.length === required.length : matches.length > 0
    if (!ok) {
      const err = new Error('Forbidden')
      ;(err as Error & { status: number }).status = 403
      throw err
    }
    return true
  },
})
```

### Step 5 — `@Public` shim (just sugar over `LoadAuthUser({on401: 'allow'})`)

```ts
// src/auth/public.ts
import { LoadAuthUser } from './load-auth-user'

// `@Public` is just `@LoadAuthUser({ on401: 'allow' })` — pass through
// without rejecting unauthenticated requests. Method-level decorators
// have higher precedence than class-level, so a `@Public()` method on
// a `@LoadAuthUser` controller wins.
export const Public = LoadAuthUser({ on401: 'allow' })
```

### Step 6 — `AuthAdapter` factory

`defineAdapter` registers DI tokens + ships cross-cutting contributors:

```ts
// src/auth/auth-adapter.ts
import { defineAdapter } from '@forinda/kickjs'
import { AUTH_STRATEGIES } from './load-auth-user'
import { LoadAuthUser } from './load-auth-user'
import type { AuthStrategy } from './strategies'

export interface AuthAdapterOptions {
  strategies: readonly AuthStrategy[]
  /**
   * Cross-cutting policy. `'protected'` means every route requires
   * a user unless explicitly marked `@Public`. `'open'` means every
   * route is public unless explicitly marked `@LoadAuthUser`.
   */
  defaultPolicy: 'protected' | 'open'
}

export const AuthAdapter = defineAdapter<AuthAdapterOptions>({
  name: 'AuthAdapter',
  register: (container, opts) => {
    container.registerInstance(AUTH_STRATEGIES, opts.strategies)
  },
  contributors: (opts) =>
    opts.defaultPolicy === 'protected'
      ? [LoadAuthUser.with({ on401: 'reject' }).registration]
      : [LoadAuthUser.with({ on401: 'allow' }).registration],
})
```

### Step 7 — usage in a controller

```ts
import { Controller, Get, Post } from '@forinda/kickjs'
import { LoadAuthUser, RequireRole } from './auth'

@Controller()
export class UsersController {
  // Public: no auth needed (overrides the adapter's defaultPolicy).
  @LoadAuthUser({ on401: 'allow' })
  @Get('/health')
  health(ctx: RequestContext) {
    ctx.json({ ok: true })
  }

  // Adopter-protected default applies — a JWT/api-key must resolve.
  @Get('/me')
  me(ctx: RequestContext) {
    ctx.json({ user: ctx.get('user') })
  }

  // Method-level role gate.
  @RequireRole({ roles: ['admin'] })
  @Post('/users')
  create(ctx: RequestContext) {
    // ctx.get('user') is non-null here — RequireRole guarantees it.
  }

  // Multiple roles, "all-of" mode.
  @RequireRole({ roles: ['admin', 'billing'], mode: 'all' })
  @Post('/users/:id/billing')
  billing(ctx: RequestContext) {}
}
```

### Step 8 — bootstrap

```ts
import { bootstrap, getEnv } from '@forinda/kickjs'
import { AuthAdapter } from './auth/auth-adapter'
import { jwtStrategy, apiKeyStrategy } from './auth/strategies'
import { modules } from './modules'

export const app = await bootstrap({
  modules,
  adapters: [
    AuthAdapter({
      defaultPolicy: 'protected',
      strategies: [
        jwtStrategy({
          secret: getEnv('JWT_SECRET'),
          mapPayload: (p) => ({
            id: p.sub as string,
            email: p.email as string,
            roles: (p.roles as readonly string[]) ?? ['user'],
          }),
        }),
        apiKeyStrategy({
          keys: { 'sk-bot-1': { id: 'bot-1', email: 'bot@x', roles: ['bot'] } },
        }),
      ],
    }),
  ],
})
```

That's the whole auth surface. ~200 lines you own. Add CSRF, password
hashing, OAuth, sessions the same way — each as a strategy or a
parameterised contributor over the primitives the framework ships.

### What you give up (and why it's fine)

- **No `@Authenticated()` decorator** — replaced by the adapter's
  `defaultPolicy: 'protected'` shipping the cross-cutting contributor.
  Method-level `@LoadAuthUser({ on401: 'allow' })` overrides for
  public routes.
- **No `@Roles('admin')` shorthand** — `@RequireRole({ roles: ['admin'] })`
  is two extra characters and one import. The shape is now also
  customisable via the `mode: 'all' | 'any'` param.
- **No `@Policy('article')`** — write a parameterised
  `@RequirePolicy({ policy: ArticlePolicy })` contributor (12 lines)
  if you need it; most apps just inline the check inside the
  handler.
- **No `OAuthStrategy` / `SessionStrategy` / `PassportBridge` ready-made**
  — they're 50–80 lines each. Copy from `@forinda/kickjs-auth@5.1.x`
  source if you used them; they're unchanged in BYO form.

### Migration checklist

- [ ] Pin `@forinda/kickjs-auth` to `^5.1.x` until you migrate.
- [ ] Copy the recipe above into `src/auth/` (or wherever).
- [ ] Replace `import { JwtStrategy } from '@forinda/kickjs-auth'` with
      your local `jwtStrategy` (lowercase — it's a function, not a
      decorator).
- [ ] Replace `@Authenticated()` with adapter-level
      `defaultPolicy: 'protected'`.
- [ ] Replace `@Public()` with `@LoadAuthUser({ on401: 'allow' })`
      (or the `Public` shim re-export).
- [ ] Replace `@Roles('admin')` with `@RequireRole({ roles: ['admin'] })`.
- [ ] Run your existing auth tests — they should pass without changes.
- [ ] `pnpm remove @forinda/kickjs-auth`.
- [ ] Open an issue if anything from the original surface isn't
      reachable from the recipe.
