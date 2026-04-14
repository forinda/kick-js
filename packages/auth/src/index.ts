import 'reflect-metadata'

// Types & interfaces
export {
  AUTH_META,
  CSRF_META,
  RATE_LIMIT_META,
  POLICY_META,
  type AuthUser,
  type AuthStrategy,
  type AuthAdapterOptions,
  type CsrfConfig,
  type RateLimitDecoratorOptions,
  type AuthEvent,
  type AuthSuccessEvent,
  type AuthFailedEvent,
  type AuthForbiddenEvent,
  type AuthEventHandlers,
} from './types'

// Decorators
export { Authenticated, Public, Roles, CsrfExempt, RateLimit, Can } from './decorators'

// Policy-based authorization
export { Policy, AuthorizationService, policyRegistry, loadPolicies } from './policy'

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
  keycloakMapPayload,
  ApiKeyStrategy,
  OAuthStrategy,
  PassportBridge,
  SessionStrategy,
  type JwtStrategyOptions,
  type KeycloakMapOptions,
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
