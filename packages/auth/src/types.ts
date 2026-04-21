import 'reflect-metadata'

// ── Auth Metadata Keys ──────────────────────────────────────────────────

export const AUTH_META = {
  AUTHENTICATED: Symbol('auth:authenticated'),
  PUBLIC: Symbol('auth:public'),
  ROLES: Symbol('auth:roles'),
  STRATEGY: Symbol('auth:strategy'),
} as const

export const CSRF_META = {
  EXEMPT: Symbol('csrf:exempt'),
} as const

export const RATE_LIMIT_META = {
  OPTIONS: Symbol('rateLimit:options'),
} as const

export const POLICY_META = {
  ACTION: Symbol('policy:action'),
  RESOURCE: Symbol('policy:resource'),
  RESOLVER: Symbol('policy:resolver'),
} as const

export interface RateLimitDecoratorOptions {
  /** Time window in milliseconds (default: 60_000). */
  windowMs?: number
  /** Maximum requests per window (default: 100). */
  max?: number
  /**
   * Key to identify the client:
   * - `'ip'` — rate-limit by IP address (default)
   * - `'user'` — rate-limit by authenticated user ID (requires auth)
   * - function — custom key extractor receiving the raw request
   */
  key?: 'ip' | 'user' | ((req: any) => string)
}

// ── AuthUser ────────────────────────────────────────────────────────────

/**
 * The authenticated user object attached to the request.
 * Extend this via module augmentation for your app's user shape.
 *
 * @example
 * ```ts
 * declare module '@forinda/kickjs-auth' {
 *   interface AuthUser {
 *     id: string
 *     email: string
 *     roles: string[]
 *   }
 * }
 * ```
 */
export interface AuthUser {
  [key: string]: any
}

// ── AuthStrategy Interface ──────────────────────────────────────────────

/**
 * Abstract authentication strategy. Implement this to support any
 * auth mechanism: JWT, API keys, OAuth, sessions, SAML, etc.
 *
 * @example
 * ```ts
 * class SessionStrategy implements AuthStrategy {
 *   name = 'session'
 *   async validate(req) {
 *     const session = req.session
 *     if (!session?.userId) return null
 *     return { id: session.userId, roles: session.roles }
 *   }
 * }
 * ```
 */
export interface AuthStrategy {
  /** Unique name for this strategy (e.g., 'jwt', 'api-key', 'session') */
  name: string

  /**
   * Extract and validate credentials from the request.
   * Return the authenticated user, or null if authentication fails.
   *
   * @param req - Express request object
   * @returns The authenticated user, or null
   */
  validate(req: any): Promise<AuthUser | null> | AuthUser | null
}

// ── AuthAdapter Options ─────────────────────────────────────────────────

export interface AuthAdapterOptions {
  /**
   * Authentication strategies to use, in order of precedence.
   * The first strategy that returns a user wins.
   *
   * @example
   * ```ts
   * new AuthAdapter({
   *   strategies: [
   *     new JwtStrategy({ secret: process.env.JWT_SECRET! }),
   *     new ApiKeyStrategy({ keys: { 'sk-123': { name: 'CI bot', roles: ['api'] } } }),
   *   ],
   * })
   * ```
   */
  strategies: AuthStrategy[]

  /**
   * Default behavior for routes without @Authenticated or @Public.
   * - `'protected'` — all routes require auth unless marked @Public (default)
   * - `'open'` — all routes are public unless marked @Authenticated
   */
  defaultPolicy?: 'protected' | 'open'

  /**
   * Custom handler for unauthorized requests.
   * Default: responds with 401 JSON error.
   */
  onUnauthorized?: (req: any, res: any) => void

  /**
   * Custom handler for forbidden requests (role mismatch).
   * Default: responds with 403 JSON error.
   */
  onForbidden?: (req: any, res: any) => void

  /**
   * CSRF protection for cookie-based auth strategies.
   *
   * - `true` — enable with default options
   * - `false` — disable explicitly
   * - `CsrfConfig` object — enable with custom options
   * - `undefined` (default) — auto-detect: enable if any strategy uses
   *   cookies (SessionStrategy, JWT with `tokenFrom: 'cookie'`)
   *
   * Routes decorated with `@CsrfExempt()` bypass CSRF checks.
   */
  csrf?: boolean | CsrfConfig

  /**
   * Auth lifecycle event handlers for audit logging, lockout, metrics.
   * Errors in handlers are swallowed — they never break the auth flow.
   */
  events?: AuthEventHandlers

  /**
   * Resolve tenant-scoped roles for the authenticated user.
   * Called after authentication when `req.tenant` is present.
   * The resolved roles are stored in `user.tenantRoles` and used
   * by `@Roles()` instead of the global `user.roles`.
   */
  roleResolver?: (user: AuthUser, tenantId: string) => string[] | Promise<string[]>

  /**
   * Behavior of `@Can(action, resource)` when the resource has no
   * registered `@Policy()` class, or the policy class has no method
   * named `action`. See `AuthorizationServiceOptions.onMiss`.
   *
   * - `'warn'` (default) — log once per (resource, action) and 403 the request.
   * - `'error'` — return 500 (the underlying `PolicyMissingError` bubbles up).
   *   Useful in CI/test builds to fail loud on missing coverage.
   * - `'silent'` — legacy behavior; deny with no log.
   */
  policy?: {
    onMiss?: 'warn' | 'error' | 'silent'
  }
}

// ── Auth Events ──────────────────────────────────────────────────────

export interface AuthEvent {
  timestamp: Date
  req: { ip: string; method: string; url: string }
}

export interface AuthSuccessEvent extends AuthEvent {
  user: AuthUser
  strategy: string
}

export interface AuthFailedEvent extends AuthEvent {
  reason: string
}

export interface AuthForbiddenEvent extends AuthEvent {
  user: AuthUser
  requiredRoles: string[]
  userRoles: string[]
}

export interface AuthEventHandlers {
  onAuthenticated?: (event: AuthSuccessEvent) => void | Promise<void>
  onAuthFailed?: (event: AuthFailedEvent) => void | Promise<void>
  onForbidden?: (event: AuthForbiddenEvent) => void | Promise<void>
}

export interface CsrfConfig {
  /** Cookie name for the CSRF token (default: '_csrf') */
  cookie?: string
  /** Header name to check for the token (default: 'x-csrf-token') */
  header?: string
  /** HTTP methods that require CSRF validation (default: POST, PUT, PATCH, DELETE) */
  methods?: string[]
  /** Token byte length before hex encoding (default: 32) */
  tokenLength?: number
}
