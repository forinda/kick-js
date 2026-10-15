import 'reflect-metadata'
import './di-hooks'
import { _registerInjectable } from '@forinda/kickjs-di'
import { METADATA, Scope } from './interfaces'
import {
  setClassMeta,
  setMethodMeta,
  pushClassMeta,
  pushMethodMeta,
  setInMetaMap,
} from './metadata'

// The DI decorators (`@Service`, `@Inject`, `@Value`, …) live in `@forinda/kickjs-di`;
// this module adds the HTTP ones and `@Asset`, and re-exports both.
export {
  Injectable,
  Service,
  Component,
  Repository,
  PostConstruct,
  PreDestroy,
  Autowired,
  Inject,
  Value,
  Builder,
  withBuilder,
  type PropertyOrParameterDecorator,
  type EnvKey,
  type Env,
} from '@forinda/kickjs-di'

/**
 * Mark a class as an HTTP controller and register it in the DI container.
 *
 * Route prefixes are defined by the module's `routes().path` — the single
 * source of truth for where routes mount. The legacy
 * `@Controller('/path')` parameter was removed in v4; if your code
 * still passes a string, see `docs/guide/migration-v3-to-v4.md` for
 * the rename map.
 */
export function Controller(): ClassDecorator {
  return (target: any) => {
    setClassMeta(METADATA.CLASS_KIND, 'controller', target)
    _registerInjectable(target, Scope.SINGLETON)
  }
}

// ── @Asset — typed asset path injection ─────────────────────────────────

import type { KickAssets } from './assets'

/**
 * Flatten the nested `KickAssets` augmentation (typegen-emitted in
 * PR 4) into a string-literal union of dot/slash-joined paths.
 *
 * `interface KickAssets { mails: { welcome: () => string; orders: {
 * confirmation: () => string } } }` becomes
 * `'mails/welcome' | 'mails/orders/confirmation'`.
 *
 * Returns `never` when `KickAssets` is empty (no typegen has run yet)
 * so `AssetKeyArg` falls through to accept any string.
 */
type FlattenAssets<T, Prefix extends string = ''> = {
  [K in keyof T & string]: T[K] extends () => string
    ? `${Prefix}${K}`
    : T[K] extends Record<string, unknown>
      ? FlattenAssets<T[K], `${Prefix}${K}/`>
      : never
}[keyof T & string]

/** Flat union of every known `<namespace>/<key>` path. */
export type AssetKey = FlattenAssets<KickAssets>

/**
 * Constraint mirroring `ValueKey<K>` — accepts any string when
 * `AssetKey` is `never` (back-compat for adopters who haven't run
 * `kick typegen` yet) but locks the argument to known literals once
 * the typegen-augmented `KickAssets` interface is populated.
 */
type AssetKeyArg<K extends string> = [AssetKey] extends [never] ? K : K & AssetKey

/**
 * Inject the resolved file-system path for a typed asset. Mirrors
 * `@Value`'s lazy-getter pattern — the asset is resolved on every
 * property access, NOT at class instantiation, so:
 *
 * - Tests can swap fixtures + clear the cache without re-instantiating
 *   the consuming class.
 * - The first access cost is paid once per process (the manifest cache
 *   in `core/assets.ts` makes subsequent calls cheap).
 *
 * Type-safety:
 *
 * - Without typegen, any string key is accepted (back-compat — same
 *   trick as `@Value`).
 * - After typegen, `KickAssets` is populated and `AssetKey` is a
 *   union of every flattened `<namespace>/<key>` path. Unknown keys
 *   become a TS error.
 *
 * @example
 * ```ts
 * import { Service, Asset } from '@forinda/kickjs'
 *
 * `@Service()`
 * class MailService {
 *   `@Asset('mails/welcome')`
 *   private welcomeTemplate!: string
 *
 *   send(user: User) {
 *     return ejs.renderFile(this.welcomeTemplate, { user })
 *   }
 * }
 * ```
 */
export function Asset<K extends string>(assetKey: AssetKeyArg<K>): PropertyDecorator {
  return (target, propertyKey) => {
    setInMetaMap(METADATA.ASSET, target, propertyKey as string, { assetKey })
  }
}

// ── HTTP Route Decorators ───────────────────────────────────────────────

export interface RouteDefinition {
  method: string
  path: string
  handlerName: string
  validation?: {
    /** Schema validating the request body — Zod, Valibot, Yup, any Standard Schema or KickSchema. */
    body?: any
    /** Schema validating query parameters — any library `detectSchema` accepts. */
    query?: any
    /** Schema validating URL params — any library `detectSchema` accepts. */
    params?: any
    /**
     * DECLARED response schema — never validated at runtime. Feeds two
     * consumers from one source of truth: the Swagger adapter's success
     * response schema, and `kick typegen`'s `KickRoutes[...].response`
     * (winning over return-type inference when present).
     */
    response?: any
    /** Schema name in OpenAPI components/schemas for the request body. Auto-generated from handler name if omitted. */
    name?: string
  }
}

function createRouteDecorator(method: string) {
  return (path?: string, validation?: RouteDefinition['validation']): MethodDecorator => {
    return (target, propertyKey) => {
      pushClassMeta<RouteDefinition>(METADATA.ROUTES, target.constructor, {
        method,
        path: path || '/',
        handlerName: propertyKey as string,
        validation,
      })
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
export function normalizeApiQueryParamsConfig(
  config: ApiQueryParamsConfig | ColumnApiQueryParamsConfig,
): ApiQueryParamsConfig {
  if ('columns' in config && config.columns && typeof config.columns === 'object') {
    return {
      filterable: Object.keys(config.columns),
      sortable: config.sortable ? Object.keys(config.sortable) : undefined,
      searchable: config.searchColumns
        ? config.searchColumns.map((col: any) => col?.name ?? '').filter(Boolean)
        : undefined,
    }
  }
  return config as ApiQueryParamsConfig
}

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
export function ApiQueryParams(
  config: ApiQueryParamsConfig | ColumnApiQueryParamsConfig,
): MethodDecorator {
  return (target, propertyKey) => {
    const normalized = normalizeApiQueryParamsConfig(config)
    setMethodMeta(METADATA.QUERY_PARAMS, normalized, target.constructor, propertyKey as string)
  }
}

// ── Middleware Decorators ───────────────────────────────────────────────

/**
 * Middleware handler function.
 * Generic `TCtx` defaults to `any` — import `RequestContext` from
 * `@forinda/kickjs` for full type safety:
 *
 * ```ts
 * import type { MiddlewareHandler } from '@forinda/kickjs'
 * import type { RequestContext } from '@forinda/kickjs'
 *
 * const auth: MiddlewareHandler<RequestContext> = (ctx, next) => {
 *   ctx.body  // fully typed
 *   next()
 * }
 * ```
 */
export type MiddlewareHandler<TCtx = any> = (ctx: TCtx, next: () => void) => void | Promise<void>

/** Attach middleware handlers to a class or method */
export function Middleware(...handlers: MiddlewareHandler[]): ClassDecorator & MethodDecorator {
  return (target: any, propertyKey?: string | symbol) => {
    if (propertyKey) {
      pushMethodMeta(
        METADATA.METHOD_MIDDLEWARES,
        target.constructor,
        propertyKey as string,
        ...handlers,
      )
    } else {
      pushClassMeta(METADATA.CLASS_MIDDLEWARES, target, ...handlers)
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
    setMethodMeta(METADATA.FILE_UPLOAD, config, target.constructor, propertyKey as string)
  }
}
