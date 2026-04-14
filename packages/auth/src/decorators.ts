import { setClassMeta, setMethodMeta } from '@forinda/kickjs'
import { AUTH_META, CSRF_META, RATE_LIMIT_META, type RateLimitDecoratorOptions } from './types'

/**
 * Mark a controller or method as requiring authentication.
 * When applied to a controller, all methods require auth unless overridden with @Public.
 *
 * Optionally specify which strategy to use (defaults to trying all registered strategies).
 *
 * @example
 * ```ts
 * @Controller('/users')
 * @Authenticated()        // All routes require auth
 * class UserController {
 *   @Get('/')
 *   list(ctx) { ... }     // Protected
 *
 *   @Get('/public-count')
 *   @Public()              // Override: this route is open
 *   count(ctx) { ... }
 * }
 *
 * // Strategy-specific:
 * @Authenticated('api-key')
 * @Get('/webhook')
 * webhook(ctx) { ... }
 * ```
 */
export function Authenticated(strategy?: string): ClassDecorator & MethodDecorator {
  return (target: any, propertyKey?: string | symbol) => {
    if (propertyKey) {
      setMethodMeta(AUTH_META.AUTHENTICATED, true, target.constructor, propertyKey as string)
      if (strategy) {
        setMethodMeta(AUTH_META.STRATEGY, strategy, target.constructor, propertyKey as string)
      }
    } else {
      setClassMeta(AUTH_META.AUTHENTICATED, true, target)
      if (strategy) {
        setClassMeta(AUTH_META.STRATEGY, strategy, target)
      }
    }
  }
}

/**
 * Mark a method as publicly accessible, bypassing authentication.
 * Use inside an @Authenticated controller to exempt specific routes.
 *
 * @example
 * ```ts
 * @Controller('/auth')
 * @Authenticated()
 * class AuthController {
 *   @Post('/login')
 *   @Public()              // No auth required
 *   login(ctx) { ... }
 *
 *   @Get('/me')            // Auth required (inherits from controller)
 *   me(ctx) { ... }
 * }
 * ```
 */
export function Public(): MethodDecorator {
  return (target: any, propertyKey: string | symbol) => {
    setMethodMeta(AUTH_META.PUBLIC, true, target.constructor, propertyKey as string)
  }
}

/**
 * Require specific roles to access a route.
 * The authenticated user must have at least one of the specified roles.
 * Implies @Authenticated — no need to add both.
 *
 * The user object must have a `roles` property (string array).
 *
 * @example
 * ```ts
 * @Get('/admin/dashboard')
 * @Roles('admin', 'superadmin')
 * dashboard(ctx) { ... }
 *
 * @Delete('/:id')
 * @Roles('admin')
 * deleteUser(ctx) { ... }
 * ```
 */
export function Roles(...roles: string[]): MethodDecorator {
  return (target: any, propertyKey: string | symbol) => {
    setMethodMeta(AUTH_META.AUTHENTICATED, true, target.constructor, propertyKey as string)
    setMethodMeta(AUTH_META.ROLES, roles, target.constructor, propertyKey as string)
  }
}

/**
 * Exempt a route from CSRF validation.
 * Use on webhook endpoints or other routes that receive external POST requests
 * without a browser context.
 *
 * Only meaningful when CSRF protection is enabled via AuthAdapter's `csrf` option
 * or auto-detected from cookie-based auth strategies.
 *
 * @example
 * ```ts
 * @Post('/webhook')
 * @CsrfExempt()
 * handleWebhook(ctx) { ... }
 * ```
 */
export function CsrfExempt(): MethodDecorator {
  return (target: any, propertyKey: string | symbol) => {
    setMethodMeta(CSRF_META.EXEMPT, true, target.constructor, propertyKey as string)
  }
}

/**
 * Apply per-route rate limiting.
 *
 * Each decorated method gets its own independent rate-limit counter.
 * The `key` option controls what identifies a client — IP address
 * (default), authenticated user ID, or a custom function.
 *
 * Requires the AuthAdapter to be configured (it reads this metadata
 * and applies rate limiting in its middleware chain).
 *
 * @example
 * ```ts
 * @Get('/search')
 * @RateLimit({ windowMs: 60_000, max: 30 })
 * search(ctx) { ... }
 *
 * @Post('/upload')
 * @RateLimit({ windowMs: 3_600_000, max: 10, key: 'user' })
 * upload(ctx) { ... }
 * ```
 */
export function RateLimit(options: RateLimitDecoratorOptions = {}): MethodDecorator {
  return (target: any, propertyKey: string | symbol) => {
    setMethodMeta(RATE_LIMIT_META.OPTIONS, options, target.constructor, propertyKey as string)
  }
}
