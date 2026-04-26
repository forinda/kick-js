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
    AuthAdapter({
      strategies: [
        JwtStrategy({ secret: process.env.JWT_SECRET! }),
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

@Controller()
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

After authentication, the user is available via `ctx.user`:

```ts
@Get('/me')
@Authenticated()
me(ctx: RequestContext) {
  const user = ctx.user
  return ctx.json({ id: user.id, email: user.email })
}
```

For full type safety, augment the `ContextMeta` interface:

```ts
// src/types.ts
declare module '@forinda/kickjs' {
  interface ContextMeta {
    user: { id: string; email: string; roles: string[]; tenantId?: string }
  }
}
```

Now `ctx.user` and `ctx.get('user')` are fully typed across your app.

### Tenant and role accessors

Multi-tenant apps commonly read `tenantId` and effective `roles` off the user. `RequestContext` exposes these directly:

```ts
@Get('/flocks')
list(ctx: RequestContext) {
  return ctx.json({
    tenant: ctx.tenantId,   // reads user.tenantId
    roles: ctx.roles,       // prefers user.tenantRoles, falls back to user.roles
  })
}
```

- `ctx.tenantId` — `string | undefined`, reads `user.tenantId`.
- `ctx.roles` — `string[]`, prefers `user.tenantRoles` (set by `AuthAdapterOptions.roleResolver` when `req.tenant` is present), falls back to `user.roles`, empty array otherwise.

For tenant-scoped RBAC, populate `tenantRoles` via `AuthAdapterOptions.roleResolver`:

```ts
AuthAdapter({
  strategies: [...],
  roleResolver: async (user, tenantId) => {
    return db.query.memberships.findFirst({
      where: { userId: user.id, tenantId },
    }).then((m) => m?.roles ?? [])
  },
})
```

After this, `@Roles('owner')` and `ctx.roles` both see the tenant-scoped list instead of the global user roles.

## Built-in Strategies

### JwtStrategy

Production-grade JWT authentication using `jsonwebtoken`.

```ts
import { JwtStrategy } from '@forinda/kickjs-auth'

JwtStrategy({
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
| `jwksUri` | — | JWKS endpoint URL for key rotation (e.g., Keycloak, Auth0) |
| `jwksCacheTtl` | `3600000` | JWKS cache TTL in ms (default: 1 hour) |

#### JWKS URI (Key Rotation)

For identity providers that rotate keys (Keycloak, Auth0, Okta), use `jwksUri` instead of a static `secret`. The strategy fetches public keys from the JWKS endpoint and caches them.

```ts
JwtStrategy({
  jwksUri: 'https://keycloak.example.com/realms/myrealm/protocol/openid-connect/certs',
  algorithms: ['RS256'],
  mapPayload: (payload) => ({
    id: payload.sub,
    email: payload.email,
    roles: payload.realm_access?.roles ?? ['user'],
  }),
})
```

#### Keycloak Integration

Use the built-in `keycloakMapPayload` helper to extract roles from Keycloak's nested JWT structure:

```ts
import { JwtStrategy, keycloakMapPayload } from '@forinda/kickjs-auth'

JwtStrategy({
  jwksUri: `${KEYCLOAK_URL}/realms/${REALM}/protocol/openid-connect/certs`,
  algorithms: ['RS256'],
  mapPayload: keycloakMapPayload({
    clientId: 'my-app',           // extracts client-level roles
    includeRealmRoles: true,       // includes realm-level roles
  }),
})
```

The helper extracts `realm_access.roles` and `resource_access[clientId].roles` from the Keycloak token and merges them into a flat `roles` array.

### ApiKeyStrategy

Authenticate via API keys from headers or query parameters.

```ts
import { ApiKeyStrategy } from '@forinda/kickjs-auth'

// Static key map
ApiKeyStrategy({
  keys: {
    'sk-prod-abc123': { name: 'CI Bot', roles: ['api', 'deploy'] },
    'sk-prod-xyz789': { name: 'Monitoring', roles: ['api', 'read'] },
  },
})

// Database lookup
ApiKeyStrategy({
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

const googleAuth = OAuthStrategy({
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

Use it in your controller with **state validation** (CSRF protection):

```ts
import { randomBytes } from 'node:crypto'

const googleAuth = OAuthStrategy({
  provider: 'google',
  clientId: process.env.GOOGLE_CLIENT_ID!,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
  callbackUrl: 'http://localhost:3000/auth/google/callback',
  mapProfile: (profile) => ({
    id: profile.id,
    email: profile.email,
    name: profile.name,
    roles: ['user'],
  }),
  // Validate state parameter on callback (prevents CSRF)
  stateValidator: async (state, req) => {
    return req.session?.data?.oauthState === state
  },
})

@Controller()
class SocialAuthController {
  @Get('/google')
  @Public()
  loginWithGoogle(ctx: RequestContext) {
    // Generate cryptographic state and store in session
    const state = randomBytes(32).toString('hex')
    ctx.session.data.oauthState = state
    const url = googleAuth.getAuthorizationUrl(state)
    return ctx.res.redirect(url)
  }

  @Get('/google/callback')
  @Public()
  async googleCallback(ctx: RequestContext) {
    const user = await googleAuth.validate(ctx.req)
    if (!user) return ctx.res.status(401).json({ error: 'Auth failed' })
    // Clean up state
    delete ctx.session.data.oauthState
    // Issue your own JWT after social login
    const token = jwt.sign(user, JWT_SECRET, { expiresIn: '24h' })
    return ctx.json({ token, user })
  }
}
```

> **Important:** Always use `stateValidator` in production. Without it, your OAuth callback is vulnerable to CSRF attacks.

### PKCE (Mobile & SPA)

For public clients that cannot securely store a client secret, use PKCE:

```ts
const googleAuth = OAuthStrategy({
  provider: 'google',
  clientId: process.env.GOOGLE_CLIENT_ID!,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
  callbackUrl: 'http://localhost:3000/auth/google/callback',
  pkce: true,
  stateValidator: async (state, req) => req.session?.data?.oauthState === state,
  mapProfile: (profile) => ({
    id: profile.id,
    email: profile.email,
    roles: ['user'],
  }),
})

@Get('/google')
@Public()
loginWithGoogle(ctx: RequestContext) {
  const state = randomBytes(32).toString('hex')
  const { url, codeVerifier } = googleAuth.getAuthorizationUrlWithPkce(state)
  ctx.session.data.oauthState = state
  ctx.session.data.oauthCodeVerifier = codeVerifier
  return ctx.res.redirect(url)
}

@Get('/google/callback')
@Public()
async googleCallback(ctx: RequestContext) {
  // PKCE verifier is read automatically from req.session.data.oauthCodeVerifier
  const user = await googleAuth.validate(ctx.req)
  if (!user) return ctx.res.status(401).json({ error: 'Auth failed' })
  delete ctx.session.data.oauthState
  delete ctx.session.data.oauthCodeVerifier
  return ctx.json({ token: jwt.sign(user, JWT_SECRET), user })
}
```

Custom OAuth provider:

```ts
OAuthStrategy({
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

const google = PassportBridge({
  name: 'google',
  strategy: new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      callbackURL: '/auth/google/callback',
    },
    async (accessToken, refreshToken, profile, done) => {
      const user = await findOrCreateUser(profile)
      done(null, user)
    },
  ),
})

AuthAdapter({
  strategies: [jwtStrategy, google],
})
```

The bridge wraps Passport's `authenticate()` flow without needing `passport.initialize()` or session middleware.

### SessionStrategy

Built-in session-based authentication. Reads from the KickJS session middleware.

```ts
import { SessionStrategy, sessionLogin, sessionLogout } from '@forinda/kickjs-auth'
import { session } from '@forinda/kickjs'

// Bootstrap with session middleware + strategy
bootstrap({
  modules,
  middleware: [session({ secret: process.env.SESSION_SECRET! }), express.json()],
  adapters: [
    AuthAdapter({
      strategies: [SessionStrategy()],
    }),
  ],
})
```

Options:

| Option | Default | Description |
|---|---|---|
| `userKey` | `'userId'` | Key in `session.data` that indicates an authenticated user |
| `resolveUser` | — | Async function to look up the full user from session data |

Login and logout helpers:

```ts
@Post('/login')
@Public()
async login(ctx: RequestContext) {
  const user = await this.authService.validate(ctx.body)
  if (!user) return ctx.badRequest('Invalid credentials')
  await sessionLogin(ctx.session, user)  // regenerates session ID
  return ctx.json({ message: 'Logged in' })
}

@Post('/logout')
async logout(ctx: RequestContext) {
  await sessionLogout(ctx.session)       // destroys session
  return ctx.json({ message: 'Logged out' })
}
```

## Password Hashing

`PasswordService` provides secure hashing with scrypt (zero dependencies), argon2id, or bcrypt.

```ts
import { PasswordService } from '@forinda/kickjs-auth'

// Injectable via @Autowired() — auto-registered with defaults
@Service()
class UserService {
  @Autowired() private password!: PasswordService

  async register(email: string, rawPassword: string) {
    const hash = await this.password.hash(rawPassword)
    return this.repo.create({ email, passwordHash: hash })
  }

  async login(email: string, rawPassword: string) {
    const user = await this.repo.findByEmail(email)
    if (!await this.password.verify(user.passwordHash, rawPassword)) return null
    if (this.password.needsRehash(user.passwordHash)) {
      user.passwordHash = await this.password.hash(rawPassword)
      await this.repo.update(user)
    }
    return user
  }
}
```

Algorithms:

| Algorithm | Package | Default |
|---|---|---|
| `scrypt` | Built-in (Node.js) | Yes |
| `argon2id` | `pnpm add argon2` | No |
| `bcrypt` | `pnpm add bcryptjs` | No |

Password validation:

```ts
const pw = new PasswordService()
const result = pw.validate('short', {
  minLength: 8,
  requireUppercase: true,
  requireDigit: true,
})
// { valid: false, errors: ['Password must be at least 8 characters', ...] }
```

## Token Revocation

Add server-side token invalidation with a pluggable `TokenStore`:

```ts
import { JwtStrategy, MemoryTokenStore } from '@forinda/kickjs-auth'

const tokenStore = new MemoryTokenStore()

JwtStrategy({
  secret: process.env.JWT_SECRET!,
  tokenStore,                  // check revocation on every request
  revokeBy: 'jti',            // use JWT jti claim (recommended)
})

// Logout controller
@Post('/logout')
async logout(ctx: RequestContext) {
  const token = ctx.headers.authorization?.split(' ')[1]
  await tokenStore.revoke(token)
  return ctx.json({ message: 'Logged out' })
}
```

`MemoryTokenStore` is for development. Implement `TokenStore` with Redis or a database for production:

```ts
interface TokenStore {
  isRevoked(identifier: string): Promise<boolean>
  revoke(identifier: string, expiresAt?: Date): Promise<void>
  revokeAllForUser(userId: string): Promise<void>
  cleanup?(): Promise<void>
}
```

## CSRF Protection

When using cookie-based auth (session or cookie JWT), CSRF protection is **auto-enabled**. Exempt specific routes with `@CsrfExempt()`:

```ts
import { CsrfExempt } from '@forinda/kickjs-auth'

@Post('/webhook')
@CsrfExempt()
handleWebhook(ctx) { ... }
```

Control explicitly:

```ts
AuthAdapter({
  strategies,
  csrf: true,                    // force on
  csrf: false,                   // force off
  csrf: { cookie: '_xsrf' },    // custom config
  // undefined = auto-detect from strategies
})
```

### How auto-detection works

`AuthAdapter` enables CSRF when **any** registered strategy reads tokens from cookies:

- `SessionStrategy` — always cookie-based
- `JwtStrategy` with `tokenFrom: 'cookie'`

Once enabled, the middleware runs **globally on every request** — it does not know which strategy will actually match. For `POST`/`PUT`/`PATCH`/`DELETE`, it requires the `x-csrf-token` header to echo the `_csrf` cookie. Only `@Public()` and `@CsrfExempt()` routes bypass.

### CSRF with mixed strategies (BFF / gateway pattern)

A common setup: browsers authenticate with cookies (session), while a Web server forwards calls to the API with a `Bearer` JWT. When you register **both** strategies on the same `AuthAdapter`, CSRF auto-enables — and fires on the server-to-server JWT calls too, which don't send cookies or the CSRF header.

```ts
// ❌ Every Web → API write fails with "CSRF token mismatch"
AuthAdapter({
  strategies: [
    SessionStrategy({ ... }),   // browser → Web
    JwtStrategy({ ... }),        // Web → API (Bearer)
  ],
  // csrf auto-enabled → blocks server-to-server JWT calls
})
```

Pick one of the following based on where cookies actually travel:

**1. Split the surfaces.** If the API never sees cookie auth directly (all browser traffic goes through the Web/BFF), disable CSRF on the API — the Web tier owns the CSRF surface via its own session + same-origin forms:

```ts
// API gateway — JWT-only, no browser cookies
AuthAdapter({
  strategies: [JwtStrategy({ ... })],
  csrf: false,
})
```

**2. Exempt the JWT routes.** If some routes accept JWT while others accept cookies on the same app, mark the JWT routes with `@CsrfExempt()` (or use `@Strategy('jwt')` on a whole controller and exempt the class).

**3. Keep CSRF, add the header.** If browsers *do* call the API directly with cookies, keep CSRF on and make sure every mutating fetch reads `_csrf` and sends it as `x-csrf-token`.

Rule of thumb: CSRF protects **ambient credentials** (cookies the browser attaches automatically). Pure `Authorization: Bearer` calls aren't vulnerable and shouldn't go through CSRF validation.

## Per-Route Rate Limiting

Apply rate limits to individual routes:

```ts
import { RateLimit } from '@forinda/kickjs-auth'

@Get('/search')
@RateLimit({ windowMs: 60_000, max: 30 })
search(ctx) { ... }

@Post('/upload')
@RateLimit({ windowMs: 3_600_000, max: 10, key: 'user' })
upload(ctx) { ... }
```

Keys: `'ip'` (default), `'user'` (by authenticated user ID), or a custom function.

## Auth Events

Monitor auth lifecycle for audit logging, account lockout, or metrics:

```ts
AuthAdapter({
  strategies,
  events: {
    onAuthenticated: (event) => {
      auditLog.info('auth.success', { userId: event.user.id, strategy: event.strategy })
    },
    onAuthFailed: (event) => {
      lockoutService.recordFailure(event.req.ip)
    },
    onForbidden: (event) => {
      auditLog.warn('auth.forbidden', { userId: event.user.id, roles: event.userRoles })
    },
  },
})
```

Events are fire-and-forget — handler errors never break the auth flow.

## Test Mode

Skip real JWT generation in tests:

```ts
import { AuthAdapter } from '@forinda/kickjs-auth'

const adapter = AuthAdapter.testMode({
  user: { id: '1', email: 'admin@test.com', roles: ['admin'] },
})

bootstrap({ modules, adapters: [adapter] })
```

`testMode` also wires the auth axes multi-tenant apps need to mock in tests:

```ts
AuthAdapter.testMode({
  user: { id: '1', email: 'a@b.com' },
  tenantId: 't1',              // → user.tenantId
  roles: ['owner'],            // → user.tenantRoles (with tenantId) or user.roles
  allow: ['flock.view'],       // @Can('view', 'flock') → true, skips @Policy
  deny: ['flock.delete'],      // @Can('delete', 'flock') → 403, deny wins ties
})
```

- `tenantId` / `roles` populate `user.tenantId` and `user.tenantRoles` and feed the default `roleResolver`, so `@Roles('owner')` sees them.
- `allow` / `deny` short-circuit `@Can(action, resource)` checks without consulting `@Policy` classes. Entries are `'resource.action'` for an exact match or bare `'resource'` to match any action on that resource. Useful when you want to exercise denied paths without constructing policy classes for the test.

## Custom Strategy

Implement `AuthStrategy` for any auth mechanism:

```ts
import type { AuthStrategy, AuthUser } from '@forinda/kickjs-auth'

class MyStrategy implements AuthStrategy {
  name = 'custom'
  async validate(req: any): Promise<AuthUser | null> {
    // Your auth logic here
    return null
  }
}
```

## Multiple Strategies

Register multiple strategies — the first one that returns a user wins:

```ts
AuthAdapter({
  strategies: [
    JwtStrategy({ secret: JWT_SECRET }),       // Try JWT first
    ApiKeyStrategy({ keys: API_KEYS }),         // Fall back to API key
    SessionStrategy(),                          // Then session
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
AuthAdapter({ strategies, defaultPolicy: 'protected' })

// Open by default
AuthAdapter({ strategies, defaultPolicy: 'open' })
```

## Custom Error Handlers

```ts
AuthAdapter({
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

@Controller()
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
    return ctx.json(ctx.user)
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
    AuthAdapter({
      strategies: [
        JwtStrategy({
          secret: JWT_SECRET,
          mapPayload: (p) => ({ id: p.sub, email: p.email, roles: p.roles }),
        }),
      ],
    }),
  ],
})
```
