# @forinda/kickjs-auth

Pluggable authentication for KickJS — JWT, API key, OAuth, and custom strategies.

## Install

```bash
# Using the KickJS CLI (recommended — auto-installs peer dependencies)
kick add auth

# Manual install
pnpm add @forinda/kickjs-auth jsonwebtoken
```

## Features

- `AuthAdapter` — lifecycle adapter with configurable strategies
- Built-in strategies: `JwtStrategy`, `ApiKeyStrategy`, `OAuthStrategy`, `PassportBridge`, `SessionStrategy`
- Decorators: `@Authenticated`, `@Public`, `@Roles`, `@Can`, `@CsrfExempt`, `@RateLimit`
- `PasswordService` — secure hashing with scrypt/argon2/bcrypt + validation
- `TokenStore` / `MemoryTokenStore` — pluggable token revocation
- `@Policy` / `AuthorizationService` — resource-level authorization
- Auth lifecycle events (`onAuthenticated`, `onAuthFailed`, `onForbidden`)
- CSRF auto-detection for cookie-based strategies
- Per-route rate limiting with `@RateLimit()`
- Tenant-scoped RBAC via `roleResolver`
- `AuthAdapter.testMode()` for test suites
- Protected-by-default policy

## Quick Example

```typescript
import { AuthAdapter, JwtStrategy, Public, Roles } from '@forinda/kickjs-auth'

bootstrap({
  modules,
  adapters: [
    new AuthAdapter({
      strategies: [
        new JwtStrategy({
          secret: process.env.JWT_SECRET!,
          mapPayload: (p) => ({ id: p.sub, email: p.email, roles: p.roles }),
        }),
      ],
    }),
  ],
})

// All routes protected by default
@Controller('/users')
class UserController {
  @Get('/me')
  me(ctx: RequestContext) {
    return ctx.json({ user: ctx.user })
  }

  @Get('/public')
  @Public()
  publicEndpoint(ctx: RequestContext) {
    return ctx.json({ message: 'No auth required' })
  }

  @Delete('/:id')
  @Roles('admin')
  async delete(ctx: RequestContext) {
    await this.userService.delete(ctx.params.id)
    ctx.noContent()
  }
}
```

## Documentation

[Full documentation](https://forinda.github.io/kick-js/guide/authentication)

## License

MIT
