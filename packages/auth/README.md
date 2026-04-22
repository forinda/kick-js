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

- `AuthAdapter` — `defineAdapter`-built factory with configurable strategies; supports `.scoped()` for multi-realm setups and `.testMode()` for tests
- Built-in strategies: `JwtStrategy`, `ApiKeyStrategy`, `OAuthStrategy`, `PassportBridge`, `SessionStrategy`
- `createAuthStrategy()` — typed factory for custom strategies (symmetric with `defineAdapter`); supports `.scoped()` for namespaced multi-realm setups
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
- OAuth CSRF protection via `stateValidator`
- PKCE support for mobile/SPA OAuth flows
- `loadPolicies()` — auto-discover `@Policy` classes via `import.meta.glob`

## Quick Example

```typescript
import { AuthAdapter, JwtStrategy, Public, Roles } from '@forinda/kickjs-auth'

bootstrap({
  modules,
  adapters: [
    AuthAdapter({
      strategies: [
        JwtStrategy({
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

## OAuth Security

Use `stateValidator` to prevent CSRF attacks on OAuth callbacks:

```ts
OAuthStrategy({
  provider: 'google',
  clientId: process.env.GOOGLE_CLIENT_ID!,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
  callbackUrl: 'http://localhost:3000/auth/google/callback',
  stateValidator: async (state, req) => req.session?.data?.oauthState === state,
})
```

For mobile/SPA clients, enable PKCE:

```ts
const { url, codeVerifier } = strategy.getAuthorizationUrlWithPkce(state)
// Store codeVerifier in session — it's sent automatically during token exchange
```

## Policy Auto-Discovery

`@Policy()` decorators only register when their file is imported. Use `loadPolicies()` to auto-discover all policy files at startup:

```ts
import { loadPolicies } from '@forinda/kickjs-auth'

loadPolicies(import.meta.glob('./modules/**/*.policy.ts', { eager: true }))
```

## Documentation

[Full documentation](https://forinda.github.io/kick-js/guide/authentication)

## License

MIT
