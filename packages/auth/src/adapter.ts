import {
  Logger,
  HttpStatus,
  METADATA,
  getClassMeta,
  getClassMetaOrUndefined,
  getMethodMetaOrUndefined,
  type AppAdapter,
  type AdapterContext,
  type AdapterMiddleware,
  type RouteDefinition,
} from '@forinda/kickjs'

import { randomBytes } from 'node:crypto'
import {
  AUTH_META,
  CSRF_META,
  type AuthAdapterOptions,
  type AuthStrategy,
  type AuthUser,
  type CsrfConfig,
} from './types'

const log = Logger.for('AuthAdapter')

/** DI token to resolve the current authenticated user from the container */
export const AUTH_USER = Symbol('AuthUser')

/**
 * Authentication adapter — plugs into the KickJS lifecycle to protect
 * routes based on @Authenticated, @Public, and @Roles decorators.
 *
 * Supports multiple strategies (JWT, API key, custom) with first-match semantics.
 *
 * @example
 * ```ts
 * import { AuthAdapter, JwtStrategy, ApiKeyStrategy } from '@forinda/kickjs-auth'
 *
 * bootstrap({
 *   modules: [...],
 *   adapters: [
 *     new AuthAdapter({
 *       strategies: [
 *         new JwtStrategy({ secret: process.env.JWT_SECRET! }),
 *         new ApiKeyStrategy({ keys: { 'sk-123': { name: 'Bot', roles: ['api'] } } }),
 *       ],
 *       defaultPolicy: 'protected', // secure by default
 *     }),
 *   ],
 * })
 * ```
 */
export class AuthAdapter implements AppAdapter {
  name = 'AuthAdapter'
  private readonly strategies: AuthStrategy[]
  private readonly defaultPolicy: 'protected' | 'open'
  private readonly onUnauthorized: (req: any, res: any) => void
  private readonly onForbidden: (req: any, res: any) => void
  private readonly csrfEnabled: boolean
  private readonly csrfConfig: CsrfConfig

  // Collected route metadata for auth resolution
  private readonly routeControllers = new Map<string, any>()

  constructor(private options: AuthAdapterOptions) {
    this.strategies = options.strategies
    this.defaultPolicy = options.defaultPolicy ?? 'protected'

    this.onUnauthorized =
      options.onUnauthorized ??
      ((_req, res) => {
        res.status(HttpStatus.UNAUTHORIZED).json({
          statusCode: HttpStatus.UNAUTHORIZED,
          error: 'Unauthorized',
          message: 'Authentication required',
        })
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

  beforeStart({}: AdapterContext): void {
    const strategyNames = this.strategies.map((s) => s.name).join(', ')
    log.info(`Auth enabled [${strategyNames}] (default: ${this.defaultPolicy})`)
    if (this.csrfEnabled) {
      log.info('CSRF protection enabled (double-submit cookie)')
    }
  }

  // ── Core Auth Middleware ─────────────────────────────────────────────

  private createAuthMiddleware() {
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
      const user = await this.authenticate(req, strategyName)
      if (!user) {
        return this.onUnauthorized(req, res)
      }

      // Attach user to request
      req.user = user

      // Check roles if required
      const requiredRoles = this.getRequiredRoles(controllerClass, handlerName)
      if (requiredRoles && requiredRoles.length > 0) {
        const userRoles: string[] = (user as any).roles ?? []
        const hasRole = requiredRoles.some((role) => userRoles.includes(role))
        if (!hasRole) {
          return this.onForbidden(req, res)
        }
      }

      next()
    }
  }

  // ── Strategy Execution ──────────────────────────────────────────────

  private async authenticate(req: any, strategyName?: string): Promise<AuthUser | null> {
    const strategies = strategyName
      ? this.strategies.filter((s) => s.name === strategyName)
      : this.strategies

    for (const strategy of strategies) {
      try {
        const user = await strategy.validate(req)
        if (user) return user
      } catch (err: any) {
        log.debug(`Strategy ${strategy.name} failed: ${err.message}`)
      }
    }

    return null
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

      // Check @CsrfExempt() on the matched handler
      const { controllerClass, handlerName } = this.resolveHandler(req)
      if (controllerClass && handlerName) {
        const exempt = getMethodMetaOrUndefined<boolean>(
          CSRF_META.EXEMPT,
          controllerClass,
          handlerName,
        )
        if (exempt) return next()
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
}
