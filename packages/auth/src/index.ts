import 'reflect-metadata'

// Types & interfaces
export {
  AUTH_META,
  CSRF_META,
  RATE_LIMIT_META,
  type AuthUser,
  type AuthStrategy,
  type AuthAdapterOptions,
  type CsrfConfig,
  type RateLimitDecoratorOptions,
} from './types'

// Decorators
export { Authenticated, Public, Roles, CsrfExempt, RateLimit } from './decorators'

// Adapter
export { AuthAdapter, AUTH_USER } from './adapter'

// Password service
export {
  PasswordService,
  type PasswordConfig,
  type PasswordPolicy,
  type PasswordValidationResult,
} from './password.service'

// Built-in strategies
export {
  JwtStrategy,
  ApiKeyStrategy,
  OAuthStrategy,
  PassportBridge,
  SessionStrategy,
  type JwtStrategyOptions,
  type ApiKeyStrategyOptions,
  type ApiKeyUser,
  type OAuthStrategyOptions,
  type OAuthProvider,
  type OAuthEndpoints,
  type OAuthTokens,
  type SessionStrategyOptions,
} from './strategies'

// Token revocation
export type { TokenStore } from './token-store'
export { MemoryTokenStore } from './stores/memory.store'

// Session helpers
export { sessionLogin, sessionLogout } from './session.helpers'
