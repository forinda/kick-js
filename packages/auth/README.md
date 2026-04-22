# @forinda/kickjs-auth

Pluggable authentication for KickJS — JWT, API key, OAuth, Session, Passport bridge — plus `@Authenticated` / `@Public` / `@Roles` / `@Can` / `@CsrfExempt` / `@RateLimit` decorators, `@Policy` authorization, password hashing, and CSRF auto-detection.

## Install

```bash
kick add auth
```

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

@Controller('/users')
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

[forinda.github.io/kick-js/guide/authentication](https://forinda.github.io/kick-js/guide/authentication) — every strategy, OAuth + PKCE, CSRF, RBAC, policies, test mode.

## License

MIT
