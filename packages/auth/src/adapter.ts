import 'reflect-metadata'
import {
  Logger,
  HttpStatus,
  METADATA,
  type AppAdapter,
  type AdapterMiddleware,
  type Container,
  type RouteDefinition,
} from '@forinda/kickjs-core'

import { AUTH_META, type AuthAdapterOptions, type AuthStrategy, type AuthUser } from './types'

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
  private strategies: AuthStrategy[]
  private defaultPolicy: 'protected' | 'open'
  private onUnauthorized: (req: any, res: any) => void
  private onForbidden: (req: any, res: any) => void

  // Collected route metadata for auth resolution
  private routeControllers = new Map<string, any>()

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
  }

  onRouteMount(controllerClass: any, mountPath: string): void {
    this.routeControllers.set(mountPath, controllerClass)
  }

  middleware(): AdapterMiddleware[] {
    return [
      {
        handler: this.createAuthMiddleware(),
        phase: 'beforeRoutes',
      },
    ]
  }

  beforeStart(app: any, _container: Container): void {
    const strategyNames = this.strategies.map((s) => s.name).join(', ')
    log.info(`Auth enabled [${strategyNames}] (default: ${this.defaultPolicy})`)
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
   *      c. Read the controller's @Controller() path and @Get/@Post/... route metadata
   *      d. Build each route's full path within the router (controller prefix + route path)
   *      e. Match the relative path against these, including parameterized segments
   *         (e.g. /:id matches /123)
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

      const controllerPath: string =
        Reflect.getMetadata(METADATA.CONTROLLER_PATH, controllerClass) || '/'
      const routes: RouteDefinition[] = Reflect.getMetadata(METADATA.ROUTES, controllerClass) ?? []

      // Compute the path relative to the mount point
      const relativePath = reqPath.slice(mountPath.length) || '/'

      const matched = routes.find((r) => {
        if (r.method !== req.method) return false
        // Build the full route path within the router (controller prefix + route path)
        const routeSuffix = r.path === '/' ? '' : r.path
        const fullRoutePath =
          controllerPath === '/' ? routeSuffix || '/' : controllerPath + routeSuffix
        return this.pathMatches(fullRoutePath, relativePath)
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
      const isPublic = Reflect.getMetadata(AUTH_META.PUBLIC, controllerClass, handlerName)
      if (isPublic) return false

      // Method-level @Authenticated
      const methodAuth = Reflect.getMetadata(AUTH_META.AUTHENTICATED, controllerClass, handlerName)
      if (methodAuth !== undefined) return methodAuth
    }

    // Class-level @Authenticated
    const classAuth = Reflect.getMetadata(AUTH_META.AUTHENTICATED, controllerClass)
    if (classAuth !== undefined) return classAuth

    // Default policy
    return this.defaultPolicy === 'protected'
  }

  private getRequiredRoles(controllerClass: any, handlerName?: string): string[] | undefined {
    if (!controllerClass || !handlerName) return undefined
    return Reflect.getMetadata(AUTH_META.ROLES, controllerClass, handlerName)
  }

  private getStrategyName(controllerClass: any, handlerName?: string): string | undefined {
    if (!controllerClass) return undefined

    // Method-level strategy
    if (handlerName) {
      const methodStrategy = Reflect.getMetadata(AUTH_META.STRATEGY, controllerClass, handlerName)
      if (methodStrategy) return methodStrategy
    }

    // Class-level strategy
    return Reflect.getMetadata(AUTH_META.STRATEGY, controllerClass)
  }
}
