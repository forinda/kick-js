import 'reflect-metadata'

// Types & interfaces
export { AUTH_META, type AuthUser, type AuthStrategy, type AuthAdapterOptions } from './types'

// Decorators
export { Authenticated, Public, Roles } from './decorators'

// Adapter
export { AuthAdapter, AUTH_USER } from './adapter'

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
