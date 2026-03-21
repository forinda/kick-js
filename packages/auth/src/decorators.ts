import 'reflect-metadata'
import { AUTH_META } from './types'

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
      Reflect.defineMetadata(AUTH_META.AUTHENTICATED, true, target.constructor, propertyKey)
      if (strategy) {
        Reflect.defineMetadata(AUTH_META.STRATEGY, strategy, target.constructor, propertyKey)
      }
    } else {
      Reflect.defineMetadata(AUTH_META.AUTHENTICATED, true, target)
      if (strategy) {
        Reflect.defineMetadata(AUTH_META.STRATEGY, strategy, target)
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
    Reflect.defineMetadata(AUTH_META.PUBLIC, true, target.constructor, propertyKey)
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
    Reflect.defineMetadata(AUTH_META.AUTHENTICATED, true, target.constructor, propertyKey)
    Reflect.defineMetadata(AUTH_META.ROLES, roles, target.constructor, propertyKey)
  }
}
