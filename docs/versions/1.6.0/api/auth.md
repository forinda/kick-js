# @forinda/kickjs-auth

Pluggable authentication — JWT, API key, OAuth, and Passport.js bridge.

## AuthStrategy

```typescript
interface AuthStrategy {
  name: string
  validate(req: any): Promise<AuthUser | null> | AuthUser | null
}
```

## AuthUser

```typescript
interface AuthUser {
  [key: string]: any
}
```

## Decorators

```typescript
function Authenticated(strategy?: string): ClassDecorator & MethodDecorator
function Public(): MethodDecorator
function Roles(...roles: string[]): MethodDecorator
```

## AuthAdapter

```typescript
class AuthAdapter implements AppAdapter {
  constructor(options: AuthAdapterOptions)
}

interface AuthAdapterOptions {
  strategies: AuthStrategy[]
  defaultPolicy?: 'protected' | 'open'
  onUnauthorized?: (req: any, res: any) => void
  onForbidden?: (req: any, res: any) => void
}
```

## JwtStrategy

```typescript
class JwtStrategy implements AuthStrategy {
  name = 'jwt'
  constructor(options: JwtStrategyOptions)
}

interface JwtStrategyOptions {
  secret: string | Buffer
  algorithms?: string[]
  tokenFrom?: 'header' | 'query' | 'cookie'
  headerName?: string
  headerPrefix?: string
  queryParam?: string
  cookieName?: string
  mapPayload?: (payload: any) => AuthUser
}
```

## ApiKeyStrategy

```typescript
class ApiKeyStrategy implements AuthStrategy {
  name = 'api-key'
  constructor(options: ApiKeyStrategyOptions)
}

interface ApiKeyStrategyOptions {
  keys?: Record<string, ApiKeyUser>
  validate?: (key: string) => Promise<AuthUser | null> | AuthUser | null
  from?: Array<'header' | 'query'>
  headerName?: string
  queryParam?: string
}
```

## OAuthStrategy

```typescript
class OAuthStrategy implements AuthStrategy {
  name: string // 'oauth-{provider}'
  constructor(options: OAuthStrategyOptions)
  getAuthorizationUrl(state?: string): string
}

interface OAuthStrategyOptions {
  provider: 'google' | 'github' | 'discord' | 'microsoft' | 'custom'
  clientId: string
  clientSecret: string
  callbackUrl: string
  endpoints?: OAuthEndpoints
  scopes?: string[]
  mapProfile?: (profile: any, tokens: OAuthTokens) => AuthUser | Promise<AuthUser>
}
```

## PassportBridge

```typescript
class PassportBridge implements AuthStrategy {
  constructor(name: string, passportStrategy: any)
}
```

## Constants

```typescript
const AUTH_USER: symbol   // DI token for current user
const AUTH_META: {
  AUTHENTICATED: symbol
  PUBLIC: symbol
  ROLES: symbol
  STRATEGY: symbol
}
```
