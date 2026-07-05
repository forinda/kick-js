# @forinda/kickjs-auth

> **⚠️ Deprecated — moving to BYO (bring-your-own).**
>
> The framework now ships **parameterised context contributors**
> (`defineContextDecorator` with `paramDefaults` + per-call params +
> `.with()`), which give adopters all the primitives needed to
> compose their own auth flow without the ergonomic loss the package
> previously offered.
>
> **What to do:** follow the [BYO Auth recipe](https://kickjs.app/guide/byo-recipes.html#auth)
> — it composes `@LoadAuthUser` / `@RequireRole` / `@Public` from
> `defineContextDecorator` and `defineAdapter` (the same primitives
> this package wraps). ~200 lines of adopter code you own end-to-end,
> no framework upgrades silently changing your auth surface.
>
> Background: see the [Context Decorators guide](https://kickjs.app/guide/context-decorators.html)
> for the full primitive reference.
>
> **Why?** `@forinda/kickjs-auth` couples the framework's release cadence
> to a domain (auth) where every project has different requirements —
> custom claim mapping, custom session storage, custom CSRF rules,
> Passport-bridge edge cases. A BYO recipe lets each project own its
> auth surface; the framework owns only the primitives.

---

Pluggable authentication for KickJS — JWT, API key, OAuth, Session, Passport bridge — plus `@Authenticated` / `@Public` / `@Roles` / `@Can` / `@CsrfExempt` / `@RateLimit` decorators, `@Policy` authorization, password hashing, and CSRF auto-detection.

## Install

```bash
pnpm add @forinda/kickjs-auth
```

> Not available via `kick add` — `@forinda/kickjs-auth` has been removed
> from the CLI's optional-package catalog in favour of the [BYO Auth
> recipe](https://kickjs.app/guide/byo-recipes.html#auth)
> (parameterised context contributors). Existing adopters who still
> depend on this package install it manually with the command above.

## Quick Example

```ts
import { bootstrap, getEnv } from '@forinda/kickjs'
import { AuthAdapter, JwtStrategy } from '@forinda/kickjs-auth'
import { modules } from './modules'

export const app = await bootstrap({
  modules,
  adapters: [
    AuthAdapter({
      strategies: [
        JwtStrategy({
          secret: getEnv('JWT_SECRET'),
          mapPayload: (p) => ({ id: p.sub, email: p.email, roles: p.roles ?? ['user'] }),
        }),
      ],
      defaultPolicy: 'protected',
    }),
  ],
})
```

Decorate routes:

```ts
import { Controller, Get, Delete, type RequestContext } from '@forinda/kickjs'
import { Public, Roles } from '@forinda/kickjs-auth'

@Controller()
class UserController {
  @Get('/me')
  me(ctx: RequestContext) {
    return ctx.json({ user: ctx.user })
  }

  @Get('/health')
  @Public()
  health(ctx: RequestContext) {
    return ctx.json({ status: 'ok' })
  }

  @Delete('/:id')
  @Roles('admin')
  remove(ctx: RequestContext) { ... }
}
```

Custom strategies use `createAuthStrategy()` — same call/`.scoped()` ergonomics as `defineAdapter`.

## Documentation

[kickjs.app/guide/authentication](https://kickjs.app/guide/authentication) — every strategy, OAuth + PKCE, CSRF, RBAC, policies, test mode.

## License

MIT
