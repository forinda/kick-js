import 'reflect-metadata'
import { METADATA, Scope, type BeanOptions, type ServiceOptions } from './interfaces'
import { Container } from './container'

// ── Deferred Registration Queue ─────────────────────────────────────────
// Decorators execute at class-definition time (module load). The Container
// may not exist yet when the first decorator fires. We queue registrations
// and flush them on first Container.getInstance() call.

type PendingRegistration = { target: any; scope: Scope }
const pendingRegistrations: PendingRegistration[] = []
let containerRef: any = null

function flushPending(container: any): void {
  containerRef = container
  for (const { target, scope } of pendingRegistrations) {
    if (!container.has(target)) {
      container.register(target, target, scope)
    }
  }
  pendingRegistrations.length = 0
}

// Wire up synchronously — Container._onReady is called on first getInstance()
Container._onReady = flushPending

// ── Class Decorators ────────────────────────────────────────────────────

function registerInContainer(target: any, scope: Scope): void {
  Reflect.defineMetadata(METADATA.INJECTABLE, true, target)
  Reflect.defineMetadata(METADATA.SCOPE, scope, target)

  if (containerRef) {
    // Container already initialized — register immediately
    if (!containerRef.has(target)) {
      containerRef.register(target, target, scope)
    }
  } else {
    // Container not ready yet — queue for later
    pendingRegistrations.push({ target, scope })
  }
}

/** Mark a class as injectable with lifecycle scope */
export function Injectable(options?: ServiceOptions): ClassDecorator {
  return (target: any) => {
    registerInContainer(target, options?.scope ?? Scope.SINGLETON)
  }
}

/** Mark a class as a service (semantic alias for Injectable) */
export function Service(options?: ServiceOptions): ClassDecorator {
  return (target: any) => {
    registerInContainer(target, options?.scope ?? Scope.SINGLETON)
  }
}

/** Mark a class as a generic managed component */
export function Component(options?: ServiceOptions): ClassDecorator {
  return (target: any) => {
    registerInContainer(target, options?.scope ?? Scope.SINGLETON)
  }
}

/** Mark a class as a repository */
export function Repository(options?: ServiceOptions): ClassDecorator {
  return (target: any) => {
    registerInContainer(target, options?.scope ?? Scope.SINGLETON)
  }
}

/** Mark a class as a configuration provider for @Bean methods */
export function Configuration(): ClassDecorator {
  return (target: any) => {
    registerInContainer(target, Scope.SINGLETON)
    Reflect.defineMetadata(METADATA.CONFIGURATION, true, target)
  }
}

/**
 * Mark a class as an HTTP controller and register it in the DI container.
 *
 * @param path - **Deprecated.** The path parameter is no longer used for routing.
 *   Route prefixes are defined by the module's `routes().path` — the single source
 *   of truth for where routes are mounted. This parameter will be removed in a
 *   future major version.
 */
export function Controller(path?: string): ClassDecorator {
  return (target: any) => {
    registerInContainer(target, Scope.SINGLETON)
    Reflect.defineMetadata(METADATA.CONTROLLER_PATH, path || '/', target)
  }
}

// ── Method Decorators ───────────────────────────────────────────────────

/** Mark a method inside @Configuration as a bean factory */
export function Bean(options?: BeanOptions): MethodDecorator {
  return (target, propertyKey) => {
    Reflect.defineMetadata(METADATA.BEAN, true, target, propertyKey)
    if (options) {
      Reflect.defineMetadata(METADATA.BEAN_OPTIONS, options, target, propertyKey)
    }
  }
}

/** Mark a method as a lifecycle hook called after instantiation */
export function PostConstruct(): MethodDecorator {
  return (target, propertyKey) => {
    Reflect.defineMetadata(METADATA.POST_CONSTRUCT, propertyKey, target)
  }
}

// ── Property Decorators ─────────────────────────────────────────────────

/** Property injection — resolved lazily from the container */
export function Autowired(token?: any): PropertyDecorator {
  return (target, propertyKey) => {
    const existing: Map<string, any> = Reflect.getMetadata(METADATA.AUTOWIRED, target) || new Map()
    existing.set(propertyKey as string, token)
    Reflect.defineMetadata(METADATA.AUTOWIRED, existing, target)
  }
}

/**
 * Constructor parameter injection with an explicit token.
 *
 * **Constructor parameters only** — does not work as a property decorator.
 * For property injection with a token, use `@Autowired(token)` instead.
 */
export function Inject(token: any): ParameterDecorator {
  return (target, _propertyKey, parameterIndex) => {
    const existing: Record<number, any> = Reflect.getMetadata(METADATA.INJECT, target) || {}
    existing[parameterIndex] = token
    Reflect.defineMetadata(METADATA.INJECT, existing, target)
  }
}

/**
 * Inject an environment variable value. Evaluated lazily so the env
 * is available at access time, not at decoration time.
 *
 * If no default is provided and the env var is missing, throws at access time
 * to catch misconfiguration early instead of returning undefined.
 *
 * Uses metadata + instance getter to work correctly with `useDefineForClassFields`.
 */
export function Value(envKey: string, defaultValue?: any): PropertyDecorator {
  return (target, propertyKey) => {
    const existing: Map<string, { envKey: string; defaultValue?: any }> =
      Reflect.getMetadata(METADATA.VALUE, target) || new Map()
    existing.set(propertyKey as string, { envKey, defaultValue })
    Reflect.defineMetadata(METADATA.VALUE, existing, target)
  }
}

// ── HTTP Route Decorators ───────────────────────────────────────────────

export interface RouteDefinition {
  method: string
  path: string
  handlerName: string
  validation?: {
    /** JSON Schema object for validating the request body */
    body?: any
    /** JSON Schema object for validating query parameters */
    query?: any
    /** JSON Schema object for validating URL params */
    params?: any
    /** Schema name in OpenAPI components/schemas for the request body. Auto-generated from handler name if omitted. */
    name?: string
  }
}

function createRouteDecorator(method: string) {
  return (path?: string, validation?: RouteDefinition['validation']): MethodDecorator => {
    return (target, propertyKey) => {
      const routes: RouteDefinition[] =
        Reflect.getMetadata(METADATA.ROUTES, target.constructor) || []
      routes.push({
        method,
        path: path || '/',
        handlerName: propertyKey as string,
        validation,
      })
      Reflect.defineMetadata(METADATA.ROUTES, routes, target.constructor)
    }
  }
}

export const Get = createRouteDecorator('GET')
export const Post = createRouteDecorator('POST')
export const Put = createRouteDecorator('PUT')
export const Delete = createRouteDecorator('DELETE')
export const Patch = createRouteDecorator('PATCH')

// ── Query Params Decorator ─────────────────────────────────────────────

export interface ApiQueryParamsConfig {
  /** Fields that can be used in filter queries (e.g., `?filter=status:eq:active`) */
  filterable?: string[]
  /** Fields that can be used in sort queries (e.g., `?sort=createdAt:desc`) */
  sortable?: string[]
  /** Fields that are searched with the `?q=` parameter */
  searchable?: string[]
}

/**
 * Document the query parameters accepted by a GET endpoint.
 * Used by SwaggerAdapter to generate `filter`, `sort`, `page`, `limit`, and `q` params
 * in the OpenAPI spec, with descriptions listing the allowed fields.
 *
 * @example
 * ```ts
 * @Get('/')
 * @ApiQueryParams({
 *   filterable: ['status', 'category', 'price'],
 *   sortable: ['name', 'createdAt', 'price'],
 *   searchable: ['name', 'description'],
 * })
 * list(ctx: RequestContext) {
 *   const parsed = ctx.qs({ filterable: ['status', 'category', 'price'], ... })
 * }
 * ```
 */
export function ApiQueryParams(config: ApiQueryParamsConfig): MethodDecorator {
  return (target, propertyKey) => {
    Reflect.defineMetadata(METADATA.QUERY_PARAMS, config, target.constructor, propertyKey)
  }
}

// ── Middleware Decorators ───────────────────────────────────────────────

export type MiddlewareHandler = (ctx: any, next: () => void) => void | Promise<void>

/** Attach middleware handlers to a class or method */
export function Middleware(...handlers: MiddlewareHandler[]): ClassDecorator & MethodDecorator {
  return (target: any, propertyKey?: string | symbol) => {
    if (propertyKey) {
      // Method-level middleware
      const existing: MiddlewareHandler[] =
        Reflect.getMetadata(METADATA.METHOD_MIDDLEWARES, target.constructor, propertyKey) || []
      Reflect.defineMetadata(
        METADATA.METHOD_MIDDLEWARES,
        [...existing, ...handlers],
        target.constructor,
        propertyKey,
      )
    } else {
      // Class-level middleware
      const existing: MiddlewareHandler[] =
        Reflect.getMetadata(METADATA.CLASS_MIDDLEWARES, target) || []
      Reflect.defineMetadata(METADATA.CLASS_MIDDLEWARES, [...existing, ...handlers], target)
    }
  }
}

// ── File Upload Decorator ───────────────────────────────────────────────

/**
 * File filter — accepts short extensions ('jpg'), full MIME types ('image/jpeg'),
 * wildcards ('image/*'), or a function `(mimetype, filename) => boolean` for full control.
 */
export type FileTypeFilter = string[] | ((mimetype: string, filename: string) => boolean)

/**
 * Shared upload options used by both the `@FileUpload` decorator and the
 * `upload.single()` / `upload.array()` / `upload.none()` middleware.
 */
export interface BaseUploadOptions {
  /** Max file size in bytes (default: 5MB) */
  maxSize?: number
  /**
   * Allowed file types:
   * - **string[]** — short extensions ('jpg'), full MIME types ('image/jpeg'), or wildcards ('image/*')
   * - **function** — `(mimetype, filename) => boolean` for full control
   */
  allowedTypes?: FileTypeFilter
  /** Extend the built-in extension-to-MIME map */
  customMimeMap?: Record<string, string>
}

export interface FileUploadConfig extends BaseUploadOptions {
  mode: 'single' | 'array' | 'none'
  /** Form field name (default: 'file') */
  fieldName?: string
  /** Max files for array mode (default: 10) */
  maxCount?: number
}

/** Configure file upload handling for a controller method */
export function FileUpload(config: FileUploadConfig): MethodDecorator {
  return (target, propertyKey) => {
    Reflect.defineMetadata(METADATA.FILE_UPLOAD, config, target.constructor, propertyKey)
  }
}

// ── Builder Decorator ───────────────────────────────────────────────────

/** Add a static builder() method for fluent construction */
export function Builder(target: any): void {
  Reflect.defineMetadata(METADATA.BUILDER, true, target)

  target.builder = function () {
    const props: Record<string, any> = {}
    const proxy: any = new Proxy(
      {},
      {
        get(_, key) {
          if (key === 'build') {
            return () => Object.assign(new target(), props)
          }
          return (value: any) => {
            props[key as string] = value
            return proxy
          }
        },
      },
    )
    return proxy
  }
}
