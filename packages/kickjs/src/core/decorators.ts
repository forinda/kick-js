import 'reflect-metadata'
import { METADATA, Scope, type ServiceOptions } from './interfaces'
import { Container, type KickJsRegistry } from './container'
import {
  setClassMeta,
  setMethodMeta,
  getClassMeta,
  pushClassMeta,
  pushMethodMeta,
  setInMetaMap,
  setInMetaRecord,
} from './metadata'

// ── Decorator Registration System ───────────────────────────────────────
// Decorators execute at class-definition time (module load). The Container
// may not exist yet when the first decorator fires. We queue registrations
// and flush them on first Container.getInstance() call.
//
// `allRegistrations` is a persistent registry that survives Container.reset().
// On reset (HMR), all previously decorated classes are re-registered on the
// fresh container. This ensures @Service, @Controller, @Repository, etc.
// all survive HMR without manual re-registration.

type PendingRegistration = { target: any; scope: Scope }
const pendingRegistrations: PendingRegistration[] = []
// Keyed by class name to prevent memory leaks during HMR — new class with
// the same name replaces the old entry instead of accumulating references.
const allRegistrations = new Map<string, { target: any; scope: Scope }>()
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

// On Container.reset(), update containerRef and replay ALL decorator
// registrations on the fresh container. This handles HMR where the container
// is wiped but not all decorated modules are re-evaluated.
Container._onReset = (container: any) => {
  containerRef = container
  for (const [, { target, scope }] of allRegistrations) {
    if (!container.has(target)) {
      container.register(target, target, scope)
    }
  }
}

// ── Class Decorators ────────────────────────────────────────────────────

function registerInContainer(target: any, scope: Scope): void {
  setClassMeta(METADATA.INJECTABLE, true, target)
  setClassMeta(METADATA.SCOPE, scope, target)

  // Track in persistent registry — survives Container.reset() for HMR replay.
  // Keyed by name so HMR class re-creation replaces the old entry.
  const name = target.name || String(target)
  allRegistrations.set(name, { target, scope })

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
    setClassMeta(METADATA.CLASS_KIND, 'injectable', target)
    registerInContainer(target, options?.scope ?? Scope.SINGLETON)
  }
}

/** Mark a class as a service (semantic alias for Injectable) */
export function Service(options?: ServiceOptions): ClassDecorator {
  return (target: any) => {
    setClassMeta(METADATA.CLASS_KIND, 'service', target)
    registerInContainer(target, options?.scope ?? Scope.SINGLETON)
  }
}

/** Mark a class as a generic managed component */
export function Component(options?: ServiceOptions): ClassDecorator {
  return (target: any) => {
    setClassMeta(METADATA.CLASS_KIND, 'component', target)
    registerInContainer(target, options?.scope ?? Scope.SINGLETON)
  }
}

/** Mark a class as a repository */
export function Repository(options?: ServiceOptions): ClassDecorator {
  return (target: any) => {
    setClassMeta(METADATA.CLASS_KIND, 'repository', target)
    registerInContainer(target, options?.scope ?? Scope.SINGLETON)
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
    setClassMeta(METADATA.CLASS_KIND, 'controller', target)
    registerInContainer(target, Scope.SINGLETON)
    setClassMeta(METADATA.CONTROLLER_PATH, path || '/', target)
  }
}

// ── Method Decorators ───────────────────────────────────────────────────

/** Mark a method as a lifecycle hook called after instantiation */
export function PostConstruct(): MethodDecorator {
  return (target, propertyKey) => {
    setClassMeta(METADATA.POST_CONSTRUCT, propertyKey, target)
  }
}

// ── Property Decorators ─────────────────────────────────────────────────

/** Property injection — resolved lazily from the container */
export function Autowired(token?: any): PropertyDecorator {
  return (target, propertyKey) => {
    setInMetaMap(METADATA.AUTOWIRED, target, propertyKey as string, token)
  }
}

/**
 * Constructor parameter injection with an explicit token.
 *
 * **Constructor parameters only** — does not work as a property decorator.
 * For property injection with a token, use `@Autowired(token)` instead.
 *
 * ## Typed string-literal overload (architecture.md §22.4 #3)
 *
 * When called with a string literal that matches a key of the
 * augmented `KickJsRegistry`, TypeScript narrows the parameter type
 * to the registered type. Typo'd literals become compile errors
 * (the string isn't `keyof KickJsRegistry`). Class identities and
 * `InjectionToken<T>` keep working unchanged via the second overload.
 *
 * @example
 * ```ts
 * import { Service, Inject } from '@forinda/kickjs'
 * import type { PrismaClient } from '@prisma/client'
 *
 * `@Service()`
 * class UserRepo {
 *   constructor(@Inject('kick/prisma/Client') private db: PrismaClient) {}
 * }
 * ```
 *
 * After `kick typegen` populates `.kickjs/types/registry.d.ts` the
 * literal autocompletes from the registry, and a typo
 * (`@Inject('kick/prisma/Cleint')`) becomes a TS2345 error.
 */
export function Inject<K extends keyof KickJsRegistry & string>(token: K): ParameterDecorator
export function Inject(token: unknown): ParameterDecorator
export function Inject(token: unknown): ParameterDecorator {
  return (target, _propertyKey, parameterIndex) => {
    setInMetaRecord(METADATA.INJECT, target as object, parameterIndex, token)
  }
}

/**
 * Global ambient registry of typed environment variables, populated by
 * `kick typegen` from the project's env schema (typically
 * `src/env.ts`'s `export default defineEnv(...)`).
 *
 * Empty by default — declarations come from `.kickjs/types/env.ts`
 * generated alongside the rest of the typegen output. Once populated,
 * `@Value('PORT')` autocompletes the key, type-checks the default
 * value, and `process.env.PORT` is also typed via the parallel
 * `NodeJS.ProcessEnv` augmentation in the same generated file.
 */
declare global {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface KickEnv {}
}

/** A string key known to the typed env registry (`never` until typegen runs) */
export type EnvKey = keyof KickEnv & string

/**
 * Look up the type of a typed env entry.
 *
 * Decorators can't propagate the property type from the key, so users
 * still need to write the property's type — but `Env<K>` lets them
 * derive it from `KickEnv` instead of duplicating the schema:
 *
 * ```ts
 * @Service()
 * class MyService {
 *   @Value('PORT')
 *   private port!: Env<'PORT'>  // → number, narrowed from KickEnv['PORT']
 * }
 * ```
 */
export type Env<K extends EnvKey = EnvKey> = KickEnv[K]

/**
 * Constraint that allows any string when the typed env registry is
 * empty (no `kick typegen` has run yet, so existing code with raw
 * string keys keeps working) but locks the argument down to known
 * `EnvKey` literals once the registry is populated.
 *
 * Implementation: when `EnvKey` is `never`, the conditional resolves
 * to the user's `K`, accepting anything. Once typegen has populated
 * `KickEnv`, `EnvKey` becomes a real union and the conditional forces
 * `K` to be assignable to it.
 */
type ValueKey<K extends string> = [EnvKey] extends [never] ? K : K & EnvKey

/**
 * Inject an environment variable value. Evaluated lazily so the env
 * is available at access time, not at decoration time.
 *
 * If no default is provided and the env var is missing, throws at access time
 * to catch misconfiguration early instead of returning undefined.
 *
 * Uses metadata + instance getter to work correctly with `useDefineForClassFields`.
 *
 * Type-safety:
 * - Without `kick typegen` run, any string key is accepted (back-compat).
 * - After typegen, `KickEnv` is populated and unknown keys become a tsc
 *   error. The optional `defaultValue` is type-checked against the
 *   schema's inferred type for that key.
 */
export function Value<K extends string>(
  envKey: ValueKey<K>,
  defaultValue?: K extends EnvKey ? KickEnv[K] : unknown,
): PropertyDecorator {
  return (target, propertyKey) => {
    setInMetaMap(METADATA.VALUE, target, propertyKey as string, { envKey, defaultValue })
  }
}

// ── @Asset — typed asset path injection (assets-plan.md PR 3+) ─────────

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
 * `@forinda/kickjs-http` for full type safety:
 *
 * ```ts
 * import type { MiddlewareHandler } from '@forinda/kickjs-core'
 * import type { RequestContext } from '@forinda/kickjs-http'
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

// ── Builder Decorator ───────────────────────────────────────────────────

/** Add a static builder() method for fluent construction */
export function Builder(target: any): void {
  setClassMeta(METADATA.BUILDER, true, target)

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
