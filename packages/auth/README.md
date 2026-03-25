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
- Built-in strategies: `JwtStrategy`, `ApiKeyStrategy`, `OAuthStrategy`, `PassportBridge`
- Decorators: `@Authenticated`, `@Public`, `@Roles`
- Protected-by-default or opt-in authentication policies
- `AUTH_USER` token for injecting the authenticated user

## Quick Example

```typescript
import { AuthAdapter, Public, Roles } from '@forinda/kickjs-auth'

// Bootstrap with JWT auth
bootstrap({
  modules,
  adapters: [
    new AuthAdapter({
      strategy: 'jwt',
      secret: process.env.JWT_SECRET!,
      defaultPolicy: 'protected',
    }),
  ],
})

// All routes are protected by default
@Controller('/users')
class UserController {
  @Get('/')
  async list(ctx: RequestContext) {
    ctx.json(await this.userService.findAll())
  }

  // Opt out of auth for public routes
  @Get('/public')
  @Public()
  async publicEndpoint(ctx: RequestContext) {
    ctx.json({ message: 'No auth required' })
  }

  // Role-based access
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
