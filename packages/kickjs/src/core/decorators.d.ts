import 'reflect-metadata'
import { type ServiceOptions } from './interfaces'
/** Mark a class as injectable with lifecycle scope */
export declare function Injectable(options?: ServiceOptions): ClassDecorator
/** Mark a class as a service (semantic alias for Injectable) */
export declare function Service(options?: ServiceOptions): ClassDecorator
/** Mark a class as a generic managed component */
export declare function Component(options?: ServiceOptions): ClassDecorator
/** Mark a class as a repository */
export declare function Repository(options?: ServiceOptions): ClassDecorator
/**
 * Mark a class as an HTTP controller and register it in the DI container.
 *
 * @param path - **Deprecated.** The path parameter is no longer used for routing.
 *   Route prefixes are defined by the module's `routes().path` — the single source
 *   of truth for where routes are mounted. This parameter will be removed in a
 *   future major version.
 */
export declare function Controller(path?: string): ClassDecorator
/** Mark a method as a lifecycle hook called after instantiation */
export declare function PostConstruct(): MethodDecorator
/** Property injection — resolved lazily from the container */
export declare function Autowired(token?: any): PropertyDecorator
/**
 * Constructor parameter injection with an explicit token.
 *
 * **Constructor parameters only** — does not work as a property decorator.
 * For property injection with a token, use `@Autowired(token)` instead.
 */
export declare function Inject(token: any): ParameterDecorator
/**
 * Inject an environment variable value. Evaluated lazily so the env
 * is available at access time, not at decoration time.
 *
 * If no default is provided and the env var is missing, throws at access time
 * to catch misconfiguration early instead of returning undefined.
 *
 * Uses metadata + instance getter to work correctly with `useDefineForClassFields`.
 */
export declare function Value(envKey: string, defaultValue?: any): PropertyDecorator
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
export declare const Get: (
  path?: string,
  validation?: RouteDefinition['validation'],
) => MethodDecorator
export declare const Post: (
  path?: string,
  validation?: RouteDefinition['validation'],
) => MethodDecorator
export declare const Put: (
  path?: string,
  validation?: RouteDefinition['validation'],
) => MethodDecorator
export declare const Delete: (
  path?: string,
  validation?: RouteDefinition['validation'],
) => MethodDecorator
export declare const Patch: (
  path?: string,
  validation?: RouteDefinition['validation'],
) => MethodDecorator
export interface ApiQueryParamsConfig {
  /** Fields that can be used in filter queries (e.g., `?filter=status:eq:active`) */
  filterable?: string[]
  /** Fields that can be used in sort queries (e.g., `?sort=createdAt:desc`) */
  sortable?: string[]
  /** Fields that are searched with the `?q=` parameter */
  searchable?: string[]
}
/**
 * Column-object-based query params config (e.g., from DrizzleQueryParamsConfig).
 * `Object.keys()` is used to derive field names for OpenAPI docs.
 */
export interface ColumnApiQueryParamsConfig {
  columns: Record<string, any>
  sortable?: Record<string, any>
  searchColumns?: any[]
  [key: string]: any
}
/**
 * Normalize a query params config to the string-based ApiQueryParamsConfig.
 * Handles both string-based and column-object-based configs.
 */
export declare function normalizeApiQueryParamsConfig(
  config: ApiQueryParamsConfig | ColumnApiQueryParamsConfig,
): ApiQueryParamsConfig
/**
 * Document the query parameters accepted by a GET endpoint.
 * Used by SwaggerAdapter to generate `filter`, `sort`, `page`, `limit`, and `q` params
 * in the OpenAPI spec, with descriptions listing the allowed fields.
 *
 * Accepts both string-based configs and column-object configs (e.g., DrizzleQueryParamsConfig).
 *
 * @example
 * ```ts
 * // String-based
 * @ApiQueryParams({
 *   filterable: ['status', 'category', 'price'],
 *   sortable: ['name', 'createdAt', 'price'],
 *   searchable: ['name', 'description'],
 * })
 *
 * // Column-object-based (Drizzle)
 * @ApiQueryParams(TASK_QUERY_CONFIG)
 * ```
 */
export declare function ApiQueryParams(
  config: ApiQueryParamsConfig | ColumnApiQueryParamsConfig,
): MethodDecorator
/**
 * Middleware handler function with typed RequestContext.
 *
 * ```ts
 * import type { MiddlewareHandler } from '@forinda/kickjs'
 *
 * const auth: MiddlewareHandler = (ctx, next) => {
 *   ctx.body  // fully typed — no generic needed
 *   next()
 * }
 * ```
 */
export type MiddlewareHandler = (
  ctx: import('../http/context').RequestContext,
  next: () => void,
) => void | Promise<void>
/** Attach middleware handlers to a class or method */
export declare function Middleware(
  ...handlers: MiddlewareHandler[]
): ClassDecorator & MethodDecorator
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
export declare function FileUpload(config: FileUploadConfig): MethodDecorator
/** Add a static builder() method for fluent construction */
export declare function Builder(target: any): void
//# sourceMappingURL=decorators.d.ts.map
