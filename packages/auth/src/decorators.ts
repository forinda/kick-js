import { setClassMeta, setMethodMeta } from '@forinda/kickjs'
import {
  AUTH_META,
  CSRF_META,
  RATE_LIMIT_META,
  POLICY_META,
  type AuthUser,
  type PolicyRegistry,
  type RateLimitDecoratorOptions,
} from './types'

/**
 * Resolves to the element type of {@link AuthUser}'s `roles` array when the
 * app has augmented `AuthUser` to a typed shape (e.g. `roles: ('admin' |
 * 'editor')[]`). Falls back to `string` for unaugmented apps so existing
 * `@Roles('admin', 'editor')` calls continue to typecheck unchanged.
 */
type Role = AuthUser['roles'] extends readonly (infer T)[] ? T : string

/**
 * Set of resource keys declared in {@link PolicyRegistry}. Falls back to
 * `string` when the registry is empty (no augmentation), preserving the
 * loose typing that existing `@Can('action', 'resource')` calls rely on.
 */
type PolicyResource = keyof PolicyRegistry extends never ? string : keyof PolicyRegistry & string

/**
 * Per-resource action union from {@link PolicyRegistry}. When `R` is a
 * registered resource, narrows to that resource's declared actions; falls
 * back to `string` otherwise (unregistered resource OR no augmentation).
 */
type PolicyAction<R> = R extends keyof PolicyRegistry
  ? PolicyRegistry[R] extends string
    ? PolicyRegistry[R]
    : string
  : string

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
 * **Type narrowing.** When the app augments `AuthUser['roles']` to a literal
 * union (e.g. `roles: ('admin' | 'editor')[]`), `@Roles(...)` rejects roles
 * outside that union at the decoration site. Unaugmented apps get the loose
 * `string[]` fallback — no breaking change.
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
 *
 * // With augmentation:
 * declare module '@forinda/kickjs-auth' {
 *   interface AuthUser { roles: ('admin' | 'editor')[] }
 * }
 * @Roles('admin')   // ✓
 * @Roles('typo')    // ✗ compile error
 * ```
 */
export function Roles<R extends Role>(...roles: R[]): MethodDecorator {
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

/**
 * Check a policy action before the handler runs.
 *
 * Requires a matching `@Policy('resource')` class to be registered.
 * The handler is only called if the policy method returns `true`.
 *
 * **Type narrowing.** When the app augments `PolicyRegistry`, both `action`
 * and `resource` narrow to the declared union for that resource — typos
 * become compile errors. Unaugmented apps get the loose `(string, string)`
 * fallback unchanged.
 *
 * @param action - Policy method to call (e.g., 'update', 'delete')
 * @param resource - Resource name matching a `@Policy()` registration
 *
 * @example
 * ```ts
 * @Delete('/:id')
 * @Can('delete', 'post')
 * async remove(ctx: RequestContext) { ... }
 *
 * // With augmentation:
 * declare module '@forinda/kickjs-auth' {
 *   interface PolicyRegistry {
 *     post: 'create' | 'update' | 'delete' | 'publish'
 *   }
 * }
 * @Can('delete', 'post')   // ✓
 * @Can('typo', 'post')     // ✗ compile error: action 'typo' not allowed for 'post'
 * @Can('delete', 'unknown') // ✗ compile error: 'unknown' is not a registered resource
 * ```
 */
export function Can<R extends PolicyResource>(
  action: PolicyAction<R>,
  resource: R,
): MethodDecorator {
  return (target: any, propertyKey: string | symbol) => {
    setMethodMeta(POLICY_META.ACTION, action, target.constructor, propertyKey as string)
    setMethodMeta(POLICY_META.RESOURCE, resource, target.constructor, propertyKey as string)
    // Implies authentication required
    setMethodMeta(AUTH_META.AUTHENTICATED, true, target.constructor, propertyKey as string)
  }
}
