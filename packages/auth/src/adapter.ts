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

  private resolveHandler(req: any): { controllerClass: any; handlerName: string | undefined } {
    // Express 5 stores matched route info
    const route = req.route
    if (!route) {
      return { controllerClass: undefined, handlerName: undefined }
    }

    // Try to find the controller from our collected route mounts
    for (const [mountPath, controllerClass] of this.routeControllers) {
      if (req.baseUrl?.startsWith(mountPath) || req.path?.startsWith(mountPath)) {
        const routes: RouteDefinition[] =
          Reflect.getMetadata(METADATA.ROUTES, controllerClass) ?? []
        const matched = routes.find(
          (r) => r.method === req.method && this.pathMatches(r.path, req.route?.path ?? req.path),
        )
        if (matched) {
          return { controllerClass, handlerName: matched.handlerName }
        }
      }
    }

    return { controllerClass: undefined, handlerName: undefined }
  }

  private pathMatches(routePath: string, requestPath: string): boolean {
    // Normalize trailing slashes and compare
    const norm = (p: string) => p.replace(/\/+$/, '') || '/'
    return norm(routePath) === norm(requestPath)
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
