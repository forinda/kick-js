import { setMethodMeta, setClassMeta, pushMethodMeta } from '@forinda/kickjs'

/**
 * String metadata keys for the swagger decorators. Follows the §22
 * v4 'kick:area:thing' convention — survives JSON serialisation,
 * addressable by literal from cross-package consumers, visible in
 * DevTools snapshots.
 */
const SWAGGER_KEYS = {
  OPERATION: 'kick:swagger:operation',
  RESPONSES: 'kick:swagger:responses',
  TAGS: 'kick:swagger:tags',
  BEARER_AUTH: 'kick:swagger:bearer',
  /**
   * Generic security requirement(s) attached to a route. Replaces
   * the implicit `kick:auth:authenticated` cross-package bridge —
   * adopters now declare auth requirements explicitly via
   * `@ApiSecurity()` (single or multi-scheme, with optional OAuth
   * scopes) instead of having Swagger guess from a sibling
   * package's metadata.
   */
  SECURITY: 'kick:swagger:security',
  /**
   * Method-level opt-out from class-level security. Mirrors the
   * intent of `@Public` from auth packages but lives on Swagger's
   * own metadata namespace, so the spec builder doesn't need to
   * know about any specific auth library.
   */
  PUBLIC: 'kick:swagger:public',
  EXCLUDE: 'kick:swagger:exclude',
} as const

export { SWAGGER_KEYS }

/**
 * One entry in a route's OpenAPI security requirement list. Maps to
 * the `SecurityRequirementObject` in the OpenAPI 3 spec — `name`
 * references a scheme declared under `components.securitySchemes`,
 * and `scopes` is the optional OAuth2 / OpenID Connect scope list
 * (empty array for non-OAuth schemes).
 */
export interface ApiSecurityRequirement {
  name: string
  scopes?: string[]
}

export interface ApiOperationOptions {
  summary?: string
  description?: string
  operationId?: string
  deprecated?: boolean
}

export interface ApiResponseOptions {
  status: number
  description?: string
  schema?: any
  /** Schema name in components/schemas (e.g., 'UserResponse', 'ErrorBody'). Auto-generated from handler name if omitted. */
  name?: string
}

/** Attach operation metadata to a route handler */
export function ApiOperation(options: ApiOperationOptions): MethodDecorator {
  return (target, propertyKey) => {
    setMethodMeta(SWAGGER_KEYS.OPERATION, options, target.constructor, propertyKey as string)
  }
}

/** Document a response status. Can be stacked multiple times. */
export function ApiResponse(options: ApiResponseOptions): MethodDecorator {
  return (target, propertyKey) => {
    pushMethodMeta<ApiResponseOptions>(
      SWAGGER_KEYS.RESPONSES,
      target.constructor,
      propertyKey as string,
      options,
    )
  }
}

/** Apply OpenAPI tags at class or method level */
export function ApiTags(...tags: string[]): ClassDecorator & MethodDecorator {
  return (target: any, propertyKey?: string | symbol) => {
    if (propertyKey) {
      setMethodMeta(SWAGGER_KEYS.TAGS, tags, target.constructor, propertyKey as string)
    } else {
      setClassMeta(SWAGGER_KEYS.TAGS, tags, target)
    }
  }
}

/** Mark endpoint as requiring Bearer token auth */
export function ApiBearerAuth(name = 'BearerAuth'): ClassDecorator & MethodDecorator {
  return (target: any, propertyKey?: string | symbol) => {
    if (propertyKey) {
      setMethodMeta(SWAGGER_KEYS.BEARER_AUTH, name, target.constructor, propertyKey as string)
    } else {
      setClassMeta(SWAGGER_KEYS.BEARER_AUTH, name, target)
    }
  }
}

/**
 * Attach one or more OpenAPI security requirements to a class or
 * method. Generic alternative to {@link ApiBearerAuth} — pick this
 * when the scheme isn't bearer-shaped (API key, OAuth2 with scopes,
 * OpenID Connect) or when a route accepts multiple alternative
 * schemes (`SchemeA` OR `SchemeB`).
 *
 * Pass a string for the simple "scheme by name, no scopes" case;
 * pass an object `{ name, scopes }` to attach OAuth/OIDC scopes;
 * pass an array to declare multiple alternatives.
 *
 * The referenced scheme name **must** be declared under
 * `SwaggerOptions.securitySchemes` (or via the implicit BearerAuth
 * scheme generated when `bearerAuth: true` or `@ApiBearerAuth()`
 * is used) — Swagger doesn't synthesize schemes from `@ApiSecurity`
 * names alone.
 *
 * @example
 * ```ts
 * @Controller('/users')
 * @ApiSecurity('BearerAuth')                   // class-level default
 * class UsersController {
 *   @Get('/me')
 *   @ApiSecurity({ name: 'OAuth2', scopes: ['users:read'] })  // override
 *   me() { ... }
 *
 *   @Get('/health')
 *   @ApiPublic()                                // opt out
 *   health() { ... }
 * }
 * ```
 */
export function ApiSecurity(
  requirement: string | ApiSecurityRequirement | (string | ApiSecurityRequirement)[],
): ClassDecorator & MethodDecorator {
  // Normalise everything to an `ApiSecurityRequirement[]` so the
  // builder reads a single shape. Strings become `{ name, scopes: [] }`.
  const requirements: ApiSecurityRequirement[] = (
    Array.isArray(requirement) ? requirement : [requirement]
  ).map((r) => (typeof r === 'string' ? { name: r, scopes: [] } : { scopes: [], ...r }))

  return (target: any, propertyKey?: string | symbol) => {
    if (propertyKey) {
      setMethodMeta(SWAGGER_KEYS.SECURITY, requirements, target.constructor, propertyKey as string)
    } else {
      setClassMeta(SWAGGER_KEYS.SECURITY, requirements, target)
    }
  }
}

/**
 * Mark a method as publicly accessible — opts out of any
 * class-level security requirement (set via {@link ApiSecurity}
 * or {@link ApiBearerAuth}) for this one route.
 *
 * Use when the controller is mostly secured but exposes a
 * health-check / login / public-stats endpoint that shouldn't
 * carry the inherited security requirement in the OpenAPI spec.
 */
export function ApiPublic(): MethodDecorator {
  return (target, propertyKey) => {
    setMethodMeta(SWAGGER_KEYS.PUBLIC, true, target.constructor, propertyKey as string)
  }
}

/** Exclude a controller or method from the OpenAPI spec */
export function ApiExclude(): ClassDecorator & MethodDecorator {
  return (target: any, propertyKey?: string | symbol) => {
    if (propertyKey) {
      setMethodMeta(SWAGGER_KEYS.EXCLUDE, true, target.constructor, propertyKey as string)
    } else {
      setClassMeta(SWAGGER_KEYS.EXCLUDE, true, target)
    }
  }
}
