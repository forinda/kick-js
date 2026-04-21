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
function Can(action: string, resource: string): MethodDecorator
function Policy(resource: string): ClassDecorator
```

`@Can` checks `AuthorizationService.can(user, action, resource)` before the handler runs and returns 403 on deny. `@Policy('name')` registers a class whose methods are actions (`view`, `update`, `delete`, …) that back `can()`.

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

## AuthorizationService

Programmatic authorization checks against `@Policy()`-registered classes. Registered as a DI singleton (`@Service()`) — inject via the class token (`AuthorizationService`); there is no separate symbol token.

```typescript
@Service()
class AuthorizationService {
  constructor(options?: AuthorizationServiceOptions)

  can(
    user: AuthUser,
    action: string,
    resource: string,
    resourceInstance?: any,
  ): Promise<boolean>
}

interface AuthorizationServiceOptions {
  /**
   * How to handle `@Can()` calls that reference a missing policy or action.
   *
   * - `'warn'` (default) — log once per (resource, action) and deny. Catches
   *   typos and renamed methods without breaking prod traffic.
   * - `'error'` — throw `PolicyMissingError`. Use in CI/test builds.
   * - `'silent'` — legacy behavior; deny with no log.
   */
  onMiss?: 'warn' | 'error' | 'silent'
}

class PolicyMissingError extends Error {
  readonly resource: string
  readonly action: string
}
```

`AuthAdapter` forwards `options.policy` to its internal `AuthorizationService`:

```ts
new AuthAdapter({
  strategies: [...],
  policy: { onMiss: process.env.NODE_ENV === 'test' ? 'error' : 'warn' },
})
```

- Returns `false` when no `@Policy(resource)` is registered, when the policy class has no method named `action`, or when the method returns a falsy value.
- `resourceInstance` is forwarded as the second argument to the policy method (first argument is the user).
- `@Can(action, resource)` is the decorator equivalent for controller methods and is enforced by `AuthAdapter`.

```ts
@Service()
class PostService {
  @Autowired() private authz!: AuthorizationService

  async update(user: AuthUser, id: string, data: UpdateDto) {
    const post = await this.repo.findById(id)
    if (!(await this.authz.can(user, 'update', 'post', post))) {
      throw new HttpException(HttpStatus.FORBIDDEN)
    }
    return this.repo.update(id, data)
  }
}
```

### Policy auto-discovery

```typescript
function loadPolicies(modules: Record<string, unknown>): number
```

Policy classes only self-register when their file is imported. Call `loadPolicies(import.meta.glob('./modules/**/*.policy.ts', { eager: true }))` once at startup (before `bootstrap()`) so `@Policy()` decorators fire. Returns the number of classes discovered.

## PasswordService

Password hashing, verification, rehash detection, and plaintext policy validation. Registered as a DI singleton — inject via the class token (`PasswordService`); there is no separate symbol token.

```typescript
@Service()
class PasswordService {
  constructor(config?: PasswordConfig)

  hash(password: string): Promise<string>
  verify(hash: string, password: string): Promise<boolean>
  needsRehash(hash: string): boolean
  validate(password: string, policy?: PasswordPolicy): PasswordValidationResult
}

interface PasswordConfig {
  /** Hashing algorithm (default: 'scrypt'). */
  algorithm?: 'scrypt' | 'argon2id' | 'bcrypt'

  // scrypt options
  /** CPU/memory cost N (default: 16384) */
  cost?: number
  /** Block size r (default: 8) */
  blockSize?: number
  /** Parallelism p (default: 1) */
  parallelism?: number
  /** Derived key length in bytes (default: 64) */
  keyLength?: number
  /** Salt length in bytes for scrypt (default: 16) */
  saltLength?: number

  // argon2id options
  /** Memory cost in KiB (default: 65536 = 64 MiB) */
  memoryCost?: number
  /** Iterations (default: 3) */
  timeCost?: number

  // bcrypt options
  /** Salt rounds (default: 12) */
  rounds?: number
}

interface PasswordPolicy {
  minLength?: number          // default 8
  maxLength?: number          // default 128
  requireUppercase?: boolean
  requireLowercase?: boolean
  requireDigit?: boolean
  requireSpecial?: boolean
}

interface PasswordValidationResult {
  valid: boolean
  errors: string[]
}
```

### Algorithms and peer dependencies

- `scrypt` (default) — Node built-in, no extra install.
- `argon2id` — requires `pnpm add argon2`.
- `bcrypt` — requires `pnpm add bcryptjs` (preferred, pure JS) or `pnpm add bcrypt` (native).

Missing peer deps surface as a runtime error on the first `hash()`/`verify()` call.

### Rehash on login

`verify()` auto-detects the algorithm encoded in the stored hash, so rotating `algorithm` or tuning cost parameters does not break existing users. Call `needsRehash(hash)` after a successful `verify()` and persist a fresh hash when it returns `true`:

```ts
const ok = await pw.verify(user.passwordHash, plaintext)
if (ok && pw.needsRehash(user.passwordHash)) {
  await userRepo.update(user.id, { passwordHash: await pw.hash(plaintext) })
}
```

`needsRehash()` returns `true` when the hash's algorithm differs from `config.algorithm`, or when the encoded cost parameters (scrypt `cost`/`blockSize`/`parallelism`/`keyLength`, argon2 `memoryCost`/`timeCost`, bcrypt `rounds`) no longer match the configured values.

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
