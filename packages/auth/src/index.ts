import 'reflect-metadata'

// Types & interfaces
export {
  AUTH_META,
  CSRF_META,
  type AuthUser,
  type AuthStrategy,
  type AuthAdapterOptions,
  type CsrfConfig,
} from './types'

// Decorators
export { Authenticated, Public, Roles, CsrfExempt } from './decorators'

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
  type JwtStrategyOptions,
  type ApiKeyStrategyOptions,
  type ApiKeyUser,
  type OAuthStrategyOptions,
  type OAuthProvider,
  type OAuthEndpoints,
  type OAuthTokens,
} from './strategies'
