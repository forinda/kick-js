import {
  Logger,
  HttpStatus,
  METADATA,
  defineAdapter,
  getClassMeta,
  getClassMetaOrUndefined,
  getMethodMetaOrUndefined,
  type AdapterContext,
  type AdapterFactory,
  type AdapterMiddleware,
  type AppAdapter,
  type RouteDefinition,
} from '@forinda/kickjs'

import { randomBytes } from 'node:crypto'
import {
  AUTH_META,
  CSRF_META,
  RATE_LIMIT_META,
  POLICY_META,
  type AuthAdapterOptions,
  type AuthStrategy,
  type AuthUser,
  type CsrfConfig,
  type RateLimitDecoratorOptions,
} from './types'
import { AuthorizationService } from './policy'

const log = Logger.for('AuthAdapter')

interface RateLimitCounter {
  hits: number
  resetTime: number
}

/** DI token to resolve the current authenticated user from the container */
export const AUTH_USER = Symbol('AuthUser')

/**
 * Internal implementation of the auth adapter. Holds the per-instance
 * state Maps (`routeControllers`, `rateLimitCounters`) and the resolved
 * config callbacks. Wrapped by the {@link AuthAdapter} factory below —
 * not exported.
 */
class AuthAdapterImpl implements Omit<AppAdapter, 'name'> {
  private readonly strategies: AuthStrategy[]
  private readonly defaultPolicy: 'protected' | 'open'
  private readonly onUnauthorized: (req: any, res: any) => void
  private readonly onForbidden: (req: any, res: any) => void
  private readonly csrfEnabled: boolean
  private readonly csrfConfig: CsrfConfig

  // Collected route metadata for auth resolution
  private readonly routeControllers = new Map<string, any>()

  // Per-route rate limit counters: routeKey → clientKey → counter
  private readonly rateLimitCounters = new Map<string, Map<string, RateLimitCounter>>()

  constructor(private readonly options: AuthAdapterOptions) {
    this.strategies = options.strategies
    this.defaultPolicy = options.defaultPolicy ?? 'protected'

    const isDev = process.env.NODE_ENV !== 'production'

    this.onUnauthorized =
      options.onUnauthorized ??
      ((_req, res) => {
        const body: Record<string, any> = {
          statusCode: HttpStatus.UNAUTHORIZED,
          error: 'Unauthorized',
          message: 'Authentication required',
        }
        if (isDev) {
          body.debug = {
            strategies: this.strategies.map((s) => s.name),
            defaultPolicy: this.defaultPolicy,
            hint: 'Provide a valid token or mark the route @Public()',
          }
        }
        res.status(HttpStatus.UNAUTHORIZED).json(body)
      })

    this.onForbidden =
      options.onForbidden ??
      ((_req, res) => {
        res.status(HttpStatus.FORBIDDEN).json({
          statusCode: HttpStatus.FORBIDDEN,
          error: 'Forbidden',
          message: 'Insufficient permissions',
        })
      })

    // CSRF: resolve enabled state and config
    const csrfOption = options.csrf
    if (csrfOption === true) {
      this.csrfEnabled = true
      this.csrfConfig = {}
    } else if (csrfOption === false) {
      this.csrfEnabled = false
      this.csrfConfig = {}
    } else if (typeof csrfOption === 'object') {
      this.csrfEnabled = true
      this.csrfConfig = csrfOption
    } else {
      // Auto-detect: enable if any strategy uses cookies
      this.csrfEnabled = this.hasCookieBasedStrategy()
      this.csrfConfig = {}
    }
  }

  onRouteMount(controllerClass: any, mountPath: string): void {
    this.routeControllers.set(mountPath, controllerClass)
  }

  middleware(): AdapterMiddleware[] {
    const middlewares: AdapterMiddleware[] = [
      {
        handler: this.createAuthMiddleware(),
        phase: 'beforeRoutes',
      },
    ]

    if (this.csrfEnabled) {
      middlewares.push({
        handler: this.createCsrfMiddleware(),
        phase: 'beforeRoutes',
      })
    }

    return middlewares
  }

  beforeStart({ app }: AdapterContext): void {
    const strategyNames = this.strategies.map((s) => s.name).join(', ')
    log.info(`Auth enabled [${strategyNames}] (default: ${this.defaultPolicy})`)
    if (this.csrfEnabled) {
      log.info('CSRF protection enabled (double-submit cookie)')
    }

    // Dev-only features
    if (process.env.NODE_ENV !== 'production') {
      if (this.options.roleResolver) {
        log.info('Tenant-scoped RBAC enabled via roleResolver')
      }

      // Register debug endpoint directly on Express app (not as adapter middleware)
      app.get('/__auth/debug', (_req: any, res: any) => {
        res.json({
          strategies: this.strategies.map((s) => s.name),
          defaultPolicy: this.defaultPolicy,
          csrf: { enabled: this.csrfEnabled, config: this.csrfConfig },
          events: {
            onAuthenticated: !!this.options.events?.onAuthenticated,
            onAuthFailed: !!this.options.events?.onAuthFailed,
            onForbidden: !!this.options.events?.onForbidden,
          },
          roleResolver: !!this.options.roleResolver,
          routes: Array.from(this.routeControllers.entries()).map(([path, ctrl]) => ({
            path,
            controller: ctrl.name ?? 'Anonymous',
          })),
        })
      })
      log.info('Auth debug endpoint registered at GET /__auth/debug')
    }
  }

  // ── Core Auth Middleware ─────────────────────────────────────────────

  private createAuthMiddleware() {
    const authzService = new AuthorizationService(this.options.policy)

    return async (req: any, res: any, next: any) => {
      // Find which controller + method handles this route
      const { controllerClass, handlerName } = this.resolveHandler(req)

      // Determine if this route needs auth
      const authRequired = this.isAuthRequired(controllerClass, handlerName)
      if (!authRequired) {
        return next()
      }

      // Determine which strategy to use
      const strategyName = this.getStrategyName(controllerClass, handlerName)

      // Try to authenticate
      const { user, matchedStrategy } = await this.authenticate(req, strategyName)
      if (!user) {
        this.emitEvent('onAuthFailed', {
          timestamp: new Date(),
          reason: 'No strategy returned a user',
          req: { ip: req.ip, method: req.method, url: req.url },
        })
        return this.onUnauthorized(req, res)
      }

      // Tenant-scoped role resolution
      if (req.tenant && this.options.roleResolver) {
        try {
          const tenantRoles = await this.options.roleResolver(user, req.tenant.id)
          ;(user as any).tenantId = req.tenant.id
          ;(user as any).tenantRoles = tenantRoles
        } catch (err: any) {
          log.warn(`roleResolver failed for tenant ${req.tenant.id}: ${err.message}`)
        }
      }

      // Attach user to request
      req.user = user

      // Emit success event
      this.emitEvent('onAuthenticated', {
        timestamp: new Date(),
        user,
        strategy: matchedStrategy ?? 'unknown',
        req: { ip: req.ip, method: req.method, url: req.url },
      })

      // Check roles if required — use tenantRoles when available
      const requiredRoles = this.getRequiredRoles(controllerClass, handlerName)
      if (requiredRoles && requiredRoles.length > 0) {
        const userRoles: string[] = (user as any).tenantRoles ?? (user as any).roles ?? []
        const hasRole = requiredRoles.some((role) => userRoles.includes(role))
        if (!hasRole) {
          this.emitEvent('onForbidden', {
            timestamp: new Date(),
            user,
            requiredRoles,
            userRoles,
            req: { ip: req.ip, method: req.method, url: req.url },
          })
          return this.onForbidden(req, res)
        }
      }

      // Policy-based authorization via @Can()
      if (controllerClass && handlerName) {
        const policyAction = getMethodMetaOrUndefined<string>(
          POLICY_META.ACTION,
          controllerClass,
          handlerName,
        )
        const policyResource = getMethodMetaOrUndefined<string>(
          POLICY_META.RESOURCE,
          controllerClass,
          handlerName,
        )
        if (policyAction && policyResource) {
          const allowed = await authzService.can(user, policyAction, policyResource)
          if (!allowed) {
            return this.onForbidden(req, res)
          }
        }
      }

      // Per-route rate limiting via @RateLimit()
      if (controllerClass && handlerName) {
        const rateLimitBlocked = this.checkRateLimit(controllerClass, handlerName, req, res, user)
        if (rateLimitBlocked) return
      }

      next()
    }
  }

  // ── Strategy Execution ──────────────────────────────────────────────

  private async authenticate(
    req: any,
    strategyName?: string,
  ): Promise<{ user: AuthUser | null; matchedStrategy: string | null }> {
    const strategies = strategyName
      ? this.strategies.filter((s) => s.name === strategyName)
      : this.strategies

    for (const strategy of strategies) {
      try {
        const user = await strategy.validate(req)
        if (user) return { user, matchedStrategy: strategy.name }
      } catch (err: any) {
        log.debug(`Strategy ${strategy.name} failed: ${err.message}`)
      }
    }

    return { user: null, matchedStrategy: null }
  }

  // ── Event Emission ──────────────────────────────────────────────────

  /**
   * Fire-and-forget event emission. Errors are swallowed so event
   * handlers never break the auth flow.
   */
  private emitEvent<K extends keyof NonNullable<AuthAdapterOptions['events']>>(
    name: K,
    event: any,
  ): void {
    try {
      const handler = this.options.events?.[name]
      if (handler) {
        const result = (handler as any)(event)
        // Swallow promise rejections
        if (result && typeof result.catch === 'function') {
          result.catch(() => {})
        }
      }
    } catch {
      // Swallow sync errors
    }
  }

  // ── Metadata Resolution ─────────────────────────────────────────────

  /**
   * Resolve which controller class and handler method will serve this request.
   *
   * This runs at the `beforeRoutes` middleware phase — BEFORE Express mounts
   * the router and populates `req.route`. We therefore cannot rely on
   * `req.route` and must match the request URL against collected route metadata.
   *
   * How it works:
   *
   *   1. During setup, `onRouteMount(controllerClass, mountPath)` is called for
   *      each module route. This populates `routeControllers` with entries like:
   *        "/api/v1/users" → UsersController
   *
   *   2. When a request arrives (e.g. GET /api/v1/users/me):
   *      a. Find the matching mount path prefix ("/api/v1/users")
   *      b. Compute the relative path: "/api/v1/users/me" - "/api/v1/users" = "/me"
   *      c. Read the controller's @Get/@Post/... route metadata
   *      d. Match the relative path against each route's method-level path,
   *         including parameterized segments (e.g. /:id matches /123)
   *
   *   3. Once the handler is resolved, `isAuthRequired()` can check @Public(),
   *      @Authenticated(), and @Roles() metadata on the matched method — so
   *      decorator-based auth decisions work correctly even at beforeRoutes phase.
   *
   * If no controller matches (e.g. static files, unknown paths), returns undefined
   * for both fields — `isAuthRequired()` then falls back to `defaultPolicy`.
   */
  private resolveHandler(req: any): { controllerClass: any; handlerName: string | undefined } {
    const reqPath = req.baseUrl ? req.baseUrl + req.path : req.path

    for (const [mountPath, controllerClass] of this.routeControllers) {
      if (!reqPath.startsWith(mountPath)) continue

      const routes: RouteDefinition[] = getClassMeta<RouteDefinition[]>(
        METADATA.ROUTES,
        controllerClass,
        [],
      )

      // Compute the path relative to the mount point
      const relativePath = reqPath.slice(mountPath.length) || '/'

      // Routes are registered using only method-level paths (no controller prefix),
      // so match directly against r.path.
      const matched = routes.find((r) => {
        if (r.method !== req.method) return false
        return this.pathMatches(r.path || '/', relativePath)
      })

      if (matched) {
        return { controllerClass, handlerName: matched.handlerName }
      }
    }

    return { controllerClass: undefined, handlerName: undefined }
  }

  private pathMatches(routePath: string, requestPath: string): boolean {
    const norm = (p: string) => p.replace(/\/+$/, '') || '/'
    const normalizedRoute = norm(routePath)
    const normalizedRequest = norm(requestPath)

    if (normalizedRoute === normalizedRequest) return true

    // Match parameterized routes — e.g. /:id matches /123
    const pattern = normalizedRoute.replace(/:[\w]+/g, '[^/]+')
    return new RegExp(`^${pattern}$`).test(normalizedRequest)
  }

  private isAuthRequired(controllerClass: any, handlerName?: string): boolean {
    if (!controllerClass) {
      // No controller found — apply default policy
      return this.defaultPolicy === 'protected'
    }

    // Method-level @Public always wins
    if (handlerName) {
      const isPublic = getMethodMetaOrUndefined<boolean>(
        AUTH_META.PUBLIC,
        controllerClass,
        handlerName,
      )
      if (isPublic) return false

      // Method-level @Authenticated
      const methodAuth = getMethodMetaOrUndefined<boolean>(
        AUTH_META.AUTHENTICATED,
        controllerClass,
        handlerName,
      )
      if (methodAuth !== undefined) return methodAuth
    }

    // Class-level @Authenticated
    const classAuth = getClassMetaOrUndefined<boolean>(AUTH_META.AUTHENTICATED, controllerClass)
    if (classAuth !== undefined) return classAuth

    // Default policy
    return this.defaultPolicy === 'protected'
  }

  private getRequiredRoles(controllerClass: any, handlerName?: string): string[] | undefined {
    if (!controllerClass || !handlerName) return undefined
    return getMethodMetaOrUndefined<string[]>(AUTH_META.ROLES, controllerClass, handlerName)
  }

  private getStrategyName(controllerClass: any, handlerName?: string): string | undefined {
    if (!controllerClass) return undefined

    // Method-level strategy
    if (handlerName) {
      const methodStrategy = getMethodMetaOrUndefined<string>(
        AUTH_META.STRATEGY,
        controllerClass,
        handlerName,
      )
      if (methodStrategy) return methodStrategy
    }

    // Class-level strategy
    return getClassMetaOrUndefined<string>(AUTH_META.STRATEGY, controllerClass)
  }

  // ── CSRF Protection ─────────────────────────────────────────────────

  /**
   * Detect if any configured strategy reads tokens from cookies,
   * which means the app is vulnerable to CSRF and needs protection.
   */
  private hasCookieBasedStrategy(): boolean {
    return this.strategies.some((s) => {
      // SessionStrategy always uses cookies
      if (s.name === 'session') return true
      // JwtStrategy with tokenFrom='cookie'
      if ('options' in s) {
        const opts = (s as any).options
        if (opts?.tokenFrom === 'cookie') return true
      }
      return false
    })
  }

  /**
   * Create CSRF middleware that respects @CsrfExempt() decorators.
   * Uses the double-submit cookie pattern.
   */
  private createCsrfMiddleware() {
    const cookieName = this.csrfConfig.cookie ?? '_csrf'
    const headerName = this.csrfConfig.header ?? 'x-csrf-token'
    const protectedMethods = new Set(
      (this.csrfConfig.methods ?? ['POST', 'PUT', 'PATCH', 'DELETE']).map((m) => m.toUpperCase()),
    )
    const tokenLength = this.csrfConfig.tokenLength ?? 32

    return (req: any, res: any, next: any) => {
      // Generate or reuse CSRF token cookie
      const cookies = req.cookies || {}
      let token = cookies[cookieName]

      if (!token) {
        token = randomBytes(tokenLength).toString('hex')
        res.cookie(cookieName, token, {
          httpOnly: true,
          sameSite: 'strict',
          secure: process.env.NODE_ENV === 'production',
          path: '/',
        })
      }

      // Skip for safe methods
      if (!protectedMethods.has(req.method.toUpperCase())) {
        return next()
      }

      // Check @CsrfExempt() or @Public() on the matched handler.
      // @Public() routes have no authenticated session to protect,
      // so CSRF validation is meaningless and would block legitimate
      // unauthenticated POST requests (e.g., login, registration).
      const { controllerClass, handlerName } = this.resolveHandler(req)
      if (controllerClass && handlerName) {
        const exempt = getMethodMetaOrUndefined<boolean>(
          CSRF_META.EXEMPT,
          controllerClass,
          handlerName,
        )
        if (exempt) return next()

        const isPublic = getMethodMetaOrUndefined<boolean>(
          AUTH_META.PUBLIC,
          controllerClass,
          handlerName,
        )
        if (isPublic) return next()
      }

      // Validate: header must match cookie
      const headerToken = req.headers[headerName]
      if (!headerToken || headerToken !== token) {
        return res.status(HttpStatus.FORBIDDEN).json({
          statusCode: HttpStatus.FORBIDDEN,
          error: 'Forbidden',
          message: 'CSRF token mismatch',
        })
      }

      next()
    }
  }

  // ── Per-Route Rate Limiting ─────────────────────────────────────────

  /**
   * Check @RateLimit() metadata on the matched handler. Returns `true`
   * if the request was blocked (429 sent), `false` if it passed.
   */
  private checkRateLimit(
    controllerClass: any,
    handlerName: string,
    req: any,
    res: any,
    user: AuthUser,
  ): boolean {
    const options = getMethodMetaOrUndefined<RateLimitDecoratorOptions>(
      RATE_LIMIT_META.OPTIONS,
      controllerClass,
      handlerName,
    )
    if (!options) return false

    const windowMs = options.windowMs ?? 60_000
    const max = options.max ?? 100

    // Resolve client key
    let clientKey: string
    if (typeof options.key === 'function') {
      clientKey = options.key(req)
    } else if (options.key === 'user') {
      clientKey = `user:${(user as any).id ?? 'anonymous'}`
    } else {
      clientKey = `ip:${req.ip ?? '127.0.0.1'}`
    }

    // Route key for independent counters per decorated method
    const routeKey = `${controllerClass.name ?? 'Controller'}.${handlerName}`

    if (!this.rateLimitCounters.has(routeKey)) {
      this.rateLimitCounters.set(routeKey, new Map())
    }
    const routeCounters = this.rateLimitCounters.get(routeKey)!

    const now = Date.now()
    const entry = routeCounters.get(clientKey)

    if (!entry || now > entry.resetTime) {
      routeCounters.set(clientKey, { hits: 1, resetTime: now + windowMs })
    } else {
      entry.hits++
    }

    const current = routeCounters.get(clientKey)!
    const remaining = Math.max(0, max - current.hits)

    res.setHeader('RateLimit-Limit', max)
    res.setHeader('RateLimit-Remaining', remaining)
    res.setHeader('RateLimit-Reset', Math.ceil(current.resetTime / 1000))

    if (current.hits > max) {
      res.status(429).json({
        statusCode: 429,
        error: 'Too Many Requests',
        message: 'Rate limit exceeded',
      })
      return true
    }

    return false
  }
}

/**
 * Options for {@link AuthAdapter.testMode} — opt-in convenience for
 * controller tests that need a fake authenticated user without minting
 * real JWTs.
 */
export interface AuthTestModeOptions {
  user: AuthUser
  defaultPolicy?: 'protected' | 'open'
  /** Populates `user.tenantId` and is forwarded to `roleResolver`. */
  tenantId?: string
  /**
   * Populates `user.tenantRoles` (if `tenantId` is set) or `user.roles`.
   * Also becomes the `roleResolver` return value so `@Roles()` sees them.
   */
  roles?: string[]
  /**
   * `@Can(action, resource)` calls matching these short-circuit to allow
   * without consulting the policy registry. Entries are `'resource.action'`
   * or just `'resource'` (matches any action on that resource).
   */
  allow?: string[]
  /**
   * `@Can(action, resource)` calls matching these short-circuit to deny
   * without consulting the policy registry. Takes precedence over `allow`.
   */
  deny?: string[]
}

/** Factory shape for {@link AuthAdapter} — extends the default {@link AdapterFactory} surface with the {@link AuthAdapter.testMode} static. */
export type AuthAdapterFactory = AdapterFactory<AuthAdapterOptions> & {
  /**
   * Create an AuthAdapter that accepts any request and returns a fixed test
   * user — removes the need to mint real JWTs in controller tests.
   *
   * `tenantId` / `roles` populate `user.tenantId` / `user.tenantRoles` so
   * `@Roles()` and tenant-aware handlers see the values they would in prod.
   * `allow` / `deny` short-circuit `@Can(action, resource)` decisions by
   * full name (`'flock.delete'`) or resource-only (`'flock'` = match any
   * action on that resource) — no need to stand up `@Policy` classes just
   * to exercise denial paths.
   *
   * @example
   * ```ts
   * const adapter = AuthAdapter.testMode({
   *   user: { id: '1', email: 'a@b.com' },
   *   tenantId: 't1',
   *   roles: ['owner'],
   *   allow: ['flock.view'],
   *   deny: ['flock.delete'],
   * })
   * bootstrap({ modules, adapters: [adapter] })
   * ```
   */
  testMode(options: AuthTestModeOptions): AppAdapter
}

/**
 * Authentication adapter — plugs into the KickJS lifecycle to protect
 * routes based on @Authenticated, @Public, and @Roles decorators.
 *
 * Supports multiple strategies (JWT, API key, custom) with first-match
 * semantics. Built with {@link defineAdapter} so callers get the factory
 * call surface (singleton + `.scoped()` + `.async()`) plus the
 * {@link AuthAdapter.testMode} static for tests.
 *
 * @example
 * ```ts
 * import { AuthAdapter, JwtStrategy, ApiKeyStrategy } from '@forinda/kickjs-auth'
 *
 * bootstrap({
 *   modules: [...],
 *   adapters: [
 *     AuthAdapter({
 *       strategies: [
 *         new JwtStrategy({ secret: process.env.JWT_SECRET! }),
 *         ApiKeyStrategy({ keys: { 'sk-123': { name: 'Bot', roles: ['api'] } } }),
 *       ],
 *       defaultPolicy: 'protected', // secure by default
 *     }),
 *   ],
 * })
 * ```
 */
export const AuthAdapter = (() => {
  const factory = defineAdapter<AuthAdapterOptions>({
    name: 'AuthAdapter',
    build: (config) => new AuthAdapterImpl(config),
  }) as AuthAdapterFactory

  factory.testMode = (options: AuthTestModeOptions): AppAdapter => {
    // Cast through unknown — the augmented `AuthUser['roles']` may narrow
    // to a literal union (e.g. `'admin' | 'editor'`) that test fixtures
    // can't satisfy with arbitrary string arrays. The test-mode helper
    // intentionally accepts any role string.
    const user = {
      ...options.user,
      ...(options.tenantId ? { tenantId: options.tenantId } : {}),
      ...(options.roles && !options.tenantId ? { roles: options.roles } : {}),
      ...(options.roles && options.tenantId ? { tenantRoles: options.roles } : {}),
    } as unknown as AuthUser

    const policy =
      options.allow || options.deny ? { allow: options.allow, deny: options.deny } : undefined

    return factory({
      strategies: [
        {
          name: 'test',
          validate: async () => user,
        },
      ],
      defaultPolicy: options.defaultPolicy ?? 'open',
      roleResolver: options.roles ? () => options.roles! : undefined,
      policy,
    })
  }

  return factory
})()
