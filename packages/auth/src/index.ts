/**
 * @deprecated `@forinda/kickjs-auth` is deprecated — auth is moving to
 * BYO (bring-your-own). Compose `@LoadAuthUser` / `@RequireRole` /
 * `@Public` from `defineContextDecorator` and `defineAdapter` (see the
 * BYO Auth recipe in the KickJS docs). This package will be removed in
 * a future major.
 *
 * @module @forinda/kickjs-auth
 */
import 'reflect-metadata'

import { warnDeprecated } from './deprecation'

warnDeprecated()

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
  // PolicyRegistry is the augmentation target for the type-narrowed @Can
  // and AuthorizationService.{can,listObjects}. Re-exporting from the root
  // ensures `declare module '@forinda/kickjs-auth'` merges with the same
  // interface the decorator/service signatures reference.
  type PolicyRegistry,
} from './types'

// Decorators
export { Authenticated, Public, Roles, CsrfExempt, RateLimit, Can } from './decorators'

// Policy-based authorization
export {
  Policy,
  AuthorizationService,
  PolicyMissingError,
  NotImplementedError,
  policyRegistry,
  loadPolicies,
  type AuthorizationServiceOptions,
  type PolicyMissBehavior,
} from './policy'

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
  type JwtVerifyOptions,
  type KeycloakMapOptions,
  type ApiKeyStrategyOptions,
  type ApiKeyUser,
  type OAuthStrategyOptions,
  type OAuthProvider,
  type OAuthEndpoints,
  type OAuthTokens,
  type SessionStrategyOptions,
} from './strategies'

// Custom strategy factory — symmetric with defineAdapter for adapters.
export {
  createAuthStrategy,
  type CreateAuthStrategyOptions,
  type AuthStrategyFactory,
  type StrategyBuildContext,
} from './strategies'

// Token revocation
export type { TokenStore } from './token-store'
export { MemoryTokenStore } from './stores/memory.store'

// Session helpers
export { sessionLogin, sessionLogout } from './session.helpers'
