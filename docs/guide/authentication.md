# Authentication

KickJS provides pluggable authentication through `@forinda/kickjs-auth`. Use decorators to protect routes, and swap strategies (JWT, API key, custom) without changing your controllers.

## Installation

```bash
pnpm add @forinda/kickjs-auth

# For JWT support
pnpm add jsonwebtoken @types/jsonwebtoken
```

Or via CLI:

```bash
kick add auth
```

## Quick Start

```ts
import { bootstrap } from '@forinda/kickjs'
import { AuthAdapter, JwtStrategy } from '@forinda/kickjs-auth'

bootstrap({
  modules: [...],
  adapters: [
    new AuthAdapter({
      strategies: [
        new JwtStrategy({ secret: process.env.JWT_SECRET! }),
      ],
    }),
  ],
})
```

All routes are protected by default. Use `@Public()` to exempt specific routes.

## Decorators

### @Authenticated(strategy?)

Mark a controller or method as requiring authentication.

```ts
import { Authenticated, Public, Roles } from '@forinda/kickjs-auth'

@Controller('/users')
@Authenticated()              // All routes require auth
class UserController {
  @Get('/')
  list(ctx) { ... }           // Protected

  @Get('/count')
  @Public()                   // Override: open
  count(ctx) { ... }
}
```

Optionally specify which strategy:

```ts
@Get('/webhook')
@Authenticated('api-key')    // Only API key auth
webhook(ctx) { ... }
```

### @Public()

Exempt a method from authentication inside a protected controller.

### @Roles(...roles)

Require specific roles. Implies `@Authenticated()`.

```ts
@Delete('/:id')
@Roles('admin')
deleteUser(ctx) { ... }

@Get('/dashboard')
@Roles('admin', 'manager')   // Any of these roles
dashboard(ctx) { ... }
```

The user object must have a `roles: string[]` property.

## Accessing the Authenticated User

After authentication, the user is available on `ctx.req.user`:

```ts
@Get('/me')
@Authenticated()
me(ctx: RequestContext) {
  const user = (ctx.req as any).user
  return ctx.json({ id: user.id, email: user.email })
}
```

## Built-in Strategies

### JwtStrategy

Production-grade JWT authentication using `jsonwebtoken`.

```ts
import { JwtStrategy } from '@forinda/kickjs-auth'

new JwtStrategy({
  secret: process.env.JWT_SECRET!,

  // Transform decoded payload to your user shape
  mapPayload: (payload) => ({
    id: payload.sub,
    email: payload.email,
    roles: payload.roles ?? ['user'],
  }),
})
```

Options:

| Option | Default | Description |
|---|---|---|
| `secret` | (required) | JWT secret or public key |
| `algorithms` | `['HS256']` | Allowed algorithms |
| `tokenFrom` | `'header'` | Where to read: `'header'`, `'query'`, `'cookie'` |
| `headerName` | `'authorization'` | Header name |
| `headerPrefix` | `'Bearer'` | Token prefix |
| `queryParam` | `'token'` | Query parameter name |
| `cookieName` | `'jwt'` | Cookie name |
| `mapPayload` | identity | Transform decoded JWT to AuthUser |

### ApiKeyStrategy

Authenticate via API keys from headers or query parameters.

```ts
import { ApiKeyStrategy } from '@forinda/kickjs-auth'

// Static key map
new ApiKeyStrategy({
  keys: {
    'sk-prod-abc123': { name: 'CI Bot', roles: ['api', 'deploy'] },
    'sk-prod-xyz789': { name: 'Monitoring', roles: ['api', 'read'] },
  },
})

// Database lookup
new ApiKeyStrategy({
  validate: async (key) => {
    const record = await db.apiKeys.findByKey(key)
    if (!record || record.revokedAt) return null
    return { name: record.name, roles: record.roles }
  },
})
```

Options:

| Option | Default | Description |
|---|---|---|
| `keys` | — | Static key-to-user map |
| `validate` | — | Async validator (takes precedence over `keys`) |
| `from` | `['header']` | Sources: `'header'`, `'query'` |
| `headerName` | `'x-api-key'` | Header name |
| `queryParam` | `'api_key'` | Query parameter name |

### OAuthStrategy (Social Auth)

Built-in OAuth 2.0 with pre-configured providers — no Passport needed.

Supported providers: **Google**, **GitHub**, **Discord**, **Microsoft**, or any **custom** OAuth 2.0 provider.

```ts
import { OAuthStrategy } from '@forinda/kickjs-auth'

const googleAuth = new OAuthStrategy({
  provider: 'google',
  clientId: process.env.GOOGLE_CLIENT_ID!,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
  callbackUrl: 'http://localhost:3000/auth/google/callback',
  mapProfile: (profile) => ({
    id: profile.id,
    email: profile.email,
    name: profile.name,
    avatar: profile.picture,
    roles: ['user'],
  }),
})
```

Use it in your controller:

```ts
@Controller('/auth')
class SocialAuthController {
  @Get('/google')
  @Public()
  loginWithGoogle(ctx: RequestContext) {
    const url = googleAuth.getAuthorizationUrl()
    return ctx.res.redirect(url)
  }

  @Get('/google/callback')
  @Public()
  async googleCallback(ctx: RequestContext) {
    const user = await googleAuth.validate(ctx.req)
    if (!user) return ctx.res.status(401).json({ error: 'Auth failed' })
    // Issue your own JWT after social login
    const token = jwt.sign(user, JWT_SECRET, { expiresIn: '24h' })
    return ctx.json({ token, user })
  }
}
```

Custom OAuth provider:

```ts
new OAuthStrategy({
  provider: 'custom',
  clientId: 'id',
  clientSecret: 'secret',
  callbackUrl: 'http://localhost:3000/auth/custom/callback',
  endpoints: {
    authorizeUrl: 'https://my-provider.com/authorize',
    tokenUrl: 'https://my-provider.com/token',
    userInfoUrl: 'https://my-provider.com/userinfo',
    scopes: ['profile', 'email'],
  },
})
```

### PassportBridge (Passport.js Compatibility)

Use any of Passport.js's 500+ strategies with KickJS:

```bash
pnpm add passport passport-google-oauth20
```

```ts
import { Strategy as GoogleStrategy } from 'passport-google-oauth20'
import { PassportBridge } from '@forinda/kickjs-auth'

const google = new PassportBridge('google', new GoogleStrategy({
  clientID: process.env.GOOGLE_CLIENT_ID!,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
  callbackURL: '/auth/google/callback',
}, async (accessToken, refreshToken, profile, done) => {
  const user = await findOrCreateUser(profile)
  done(null, user)
}))

new AuthAdapter({
  strategies: [jwtStrategy, google],
})
```

The bridge wraps Passport's `authenticate()` flow without needing `passport.initialize()` or session middleware.

## Custom Strategy

Implement `AuthStrategy` for any auth mechanism:

```ts
import type { AuthStrategy, AuthUser } from '@forinda/kickjs-auth'

class SessionStrategy implements AuthStrategy {
  name = 'session'

  async validate(req: any): Promise<AuthUser | null> {
    const sessionId = req.cookies?.session_id
    if (!sessionId) return null

    const session = await sessionStore.get(sessionId)
    if (!session || session.expiresAt < Date.now()) return null

    return { id: session.userId, roles: session.roles }
  }
}

// Use it
new AuthAdapter({
  strategies: [new SessionStrategy()],
})
```

### AuthStrategy Interface

```ts
interface AuthStrategy {
  name: string
  validate(req: any): Promise<AuthUser | null> | AuthUser | null
}
```

## Multiple Strategies

Register multiple strategies — the first one that returns a user wins:

```ts
new AuthAdapter({
  strategies: [
    new JwtStrategy({ secret: JWT_SECRET }),       // Try JWT first
    new ApiKeyStrategy({ keys: API_KEYS }),         // Fall back to API key
    new SessionStrategy(),                          // Then session
  ],
})
```

## Default Policy

| Policy | Behavior |
|---|---|
| `'protected'` (default) | All routes require auth unless marked `@Public()` |
| `'open'` | All routes are public unless marked `@Authenticated()` |

```ts
// Secure by default (recommended)
new AuthAdapter({ strategies, defaultPolicy: 'protected' })

// Open by default
new AuthAdapter({ strategies, defaultPolicy: 'open' })
```

## Custom Error Handlers

```ts
new AuthAdapter({
  strategies,
  onUnauthorized: (req, res) => {
    res.status(401).json({ error: 'Please log in' })
  },
  onForbidden: (req, res) => {
    res.status(403).json({ error: 'Access denied' })
  },
})
```

## Full Example

```ts
import { Controller, Get, Post, Service } from '@forinda/kickjs'
import { bootstrap, RequestContext } from '@forinda/kickjs'
import { AuthAdapter, JwtStrategy, Authenticated, Public, Roles } from '@forinda/kickjs-auth'
import jwt from 'jsonwebtoken'

const JWT_SECRET = process.env.JWT_SECRET!

@Controller('/auth')
@Authenticated()
class AuthController {
  @Post('/login')
  @Public()
  async login(ctx: RequestContext) {
    const { email, password } = ctx.body
    const user = await validateCredentials(email, password)
    const token = jwt.sign(
      { sub: user.id, email: user.email, roles: user.roles },
      JWT_SECRET,
      { expiresIn: '24h' },
    )
    return ctx.json({ token })
  }

  @Get('/me')
  me(ctx: RequestContext) {
    return ctx.json((ctx.req as any).user)
  }

  @Get('/admin')
  @Roles('admin')
  admin(ctx: RequestContext) {
    return ctx.json({ message: 'Admin access granted' })
  }
}

bootstrap({
  modules: [...],
  adapters: [
    new AuthAdapter({
      strategies: [
        new JwtStrategy({
          secret: JWT_SECRET,
          mapPayload: (p) => ({ id: p.sub, email: p.email, roles: p.roles }),
        }),
      ],
    }),
  ],
})
```
