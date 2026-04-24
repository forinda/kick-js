import {
  METADATA,
  joinPaths,
  type RouteDefinition,
  getClassMeta,
  getClassMetaOrUndefined,
  getMethodMeta,
  getMethodMetaOrUndefined,
  hasClassMeta,
} from '@forinda/kickjs'
import { SWAGGER_KEYS, type ApiOperationOptions, type ApiResponseOptions } from './decorators'
import { zodSchemaParser, type SchemaParser } from './schema-parser'

// ── Auth metadata bridge ──────────────────────────────────────────────
// Check @forinda/kickjs-auth decorators without importing the auth
// package. Auth's metadata keys (AUTH_META.AUTHENTICATED etc.) are
// string literals under the §22 'kick:auth:*' convention; we read them
// here via Reflect.getMetadata directly. The previous Symbol-by-
// description shim broke silently when either side migrated; string
// literals are byte-stable across packages.
const AUTH_KEY_AUTHENTICATED = 'kick:auth:authenticated'
const AUTH_KEY_PUBLIC = 'kick:auth:public'

const R = Reflect as {
  getMetadata?: (key: string, target: object, propertyKey?: string) => unknown
}

function getAuthMeta(key: string, target: any, propertyKey?: string): unknown {
  if (typeof R.getMetadata !== 'function') return undefined
  const proto = target.prototype ?? target
  return propertyKey ? R.getMetadata(key, proto, propertyKey) : R.getMetadata(key, target)
}

function isAuthAuthenticated(controllerClass: any, handlerName?: string): boolean {
  if (handlerName) {
    const val = getAuthMeta(AUTH_KEY_AUTHENTICATED, controllerClass, handlerName)
    if (val !== undefined) return !!val
  }
  return !!getAuthMeta(AUTH_KEY_AUTHENTICATED, controllerClass)
}

function isAuthPublic(controllerClass: any, handlerName: string): boolean {
  return !!getAuthMeta(AUTH_KEY_PUBLIC, controllerClass, handlerName)
}

export interface OpenAPIInfo {
  title: string
  version: string
  description?: string
}

export interface SwaggerOptions {
  info?: Partial<OpenAPIInfo>
  servers?: { url: string; description?: string }[]
  bearerAuth?: boolean
  /**
   * Pluggable schema parser for converting validation schemas to JSON Schema.
   * Defaults to `zodSchemaParser` which handles Zod v4+ schemas.
   *
   * Override this to use Yup, Joi, Valibot, ArkType, or any other library.
   *
   * @example
   * ```ts
   * SwaggerAdapter({
   *   schemaParser: myYupParser,
   * })
   * ```
   */
  schemaParser?: SchemaParser
}

interface RegisteredRoute {
  controllerClass: any
  mountPath: string
}

/**
 * Default route bag used when callers don't pass a config-scoped key.
 * Kept for back-compat with code that imports `registerControllerForDocs`
 * directly without going through SwaggerAdapter — those callers see the
 * legacy "global single list" behaviour.
 */
const DEFAULT_SCOPE = Symbol('kick:swagger:default-scope')

/**
 * Per-adapter route storage. The adapter's `build` closure passes its
 * config object as the scope key so two SwaggerAdapter instances in
 * the same process (test harnesses, multi-tenant pre-fork) keep
 * independent route lists. Without this, two bootstraps in one process
 * cross-contaminate each other's specs.
 */
const routesByScope = new Map<object | symbol, RegisteredRoute[]>()
routesByScope.set(DEFAULT_SCOPE, [])

function getScopeBag(scope: object | symbol | undefined): RegisteredRoute[] {
  const key = scope ?? DEFAULT_SCOPE
  let bag = routesByScope.get(key)
  if (!bag) {
    bag = []
    routesByScope.set(key, bag)
  }
  return bag
}

/**
 * Memoised spec — built lazily on the first {@link buildOpenAPISpec}
 * call after a registration change. Re-issued without rebuild on every
 * subsequent `/openapi.json` request until `clearRegisteredRoutes` or
 * `registerControllerForDocs` invalidates it.
 *
 * Keyed by reference equality on the options object so two adapters
 * with different `info.title` don't return each other's cached spec.
 * Application keeps the SwaggerAdapter config alive for the process
 * lifetime, so this is effectively a per-adapter memo cache. WeakMap
 * keeps the entries collectable when an adapter is disposed.
 *
 * `cacheKeys` is the iteration handle (WeakMap doesn't expose one) so
 * we can flush every cached spec on registration change without
 * tracking adapters individually.
 */
const specCache = new WeakMap<object, unknown>()
const cacheKeys = new Set<object>()

function invalidateSpecCache(scope?: object | symbol): void {
  if (scope && typeof scope === 'object') {
    // Targeted invalidation — only the spec keyed on this config is stale.
    if (cacheKeys.has(scope)) {
      specCache.delete(scope)
      cacheKeys.delete(scope)
    }
    return
  }
  // Fallback: flush every cached spec (legacy untyped invalidation).
  for (const key of cacheKeys) specCache.delete(key)
  cacheKeys.clear()
}

/**
 * Register a controller for OpenAPI introspection. Called by Application
 * during route mounting via the adapter's onRouteMount hook.
 *
 * The optional `scope` argument keys the registration to a specific
 * adapter instance — pass the adapter's own config object as the key
 * (the SwaggerAdapter does this automatically). Omit for legacy
 * single-list behaviour, which is fine for single-bootstrap apps.
 */
export function registerControllerForDocs(
  controllerClass: any,
  mountPath: string,
  scope?: object,
): void {
  getScopeBag(scope).push({ controllerClass, mountPath })
  invalidateSpecCache(scope)
}

/**
 * Clear registered routes — supports HMR rebuilds. Pass the adapter's
 * config object to clear only that adapter's routes; omit to clear
 * every scope (legacy/global behaviour).
 */
export function clearRegisteredRoutes(scope?: object): void {
  if (scope && typeof scope === 'object') {
    routesByScope.delete(scope)
    invalidateSpecCache(scope)
    return
  }
  routesByScope.clear()
  routesByScope.set(DEFAULT_SCOPE, [])
  invalidateSpecCache()
}

/**
 * Build a full OpenAPI 3.0.3 spec from registered controllers and
 * their decorators.
 *
 * Memoised — the first call for a given `options` object walks every
 * controller (~80–150ms for a 200-route app); subsequent calls return
 * the cached spec until {@link clearRegisteredRoutes} or
 * {@link registerControllerForDocs} invalidate. This matters because
 * Swagger UI re-fetches `/openapi.json` on every navigation; before
 * the cache, every fetch re-walked the entire controller graph.
 */
export function buildOpenAPISpec(options: SwaggerOptions = {}): any {
  const cacheKey = options as object
  const cached = specCache.get(cacheKey)
  if (cached !== undefined) return cached
  const built = buildOpenAPISpecUncached(options)
  specCache.set(cacheKey, built)
  cacheKeys.add(cacheKey)
  return built
}

function buildOpenAPISpecUncached(options: SwaggerOptions = {}): any {
  const parser = options.schemaParser ?? zodSchemaParser

  /** Convert a validation schema to JSON Schema using the configured parser */
  const toJsonSchema = (schema: unknown): Record<string, unknown> | null => {
    try {
      if (!parser.supports(schema)) return null
      return parser.toJsonSchema(schema)
    } catch {
      return null
    }
  }

  const componentSchemas: Record<string, any> = {}
  let schemaCounter = 0

  /**
   * Register a schema in components.schemas and return a $ref pointer.
   * If the schema has a title/label, use that as the name. Otherwise generate one.
   */
  const registerSchema = (jsonSchema: Record<string, unknown>, hint?: string): any => {
    // Try to extract a name from the schema
    let name = (jsonSchema.title as string) || (jsonSchema.label as string) || hint || ''
    if (!name) {
      name = `Schema${++schemaCounter}`
    }
    // Sanitize name for OpenAPI (remove spaces, special chars)
    name = name.replace(/[^a-zA-Z0-9]/g, '')

    // Avoid duplicates — if already registered with same name, reuse
    if (!componentSchemas[name]) {
      const clean = { ...jsonSchema }
      delete clean.title
      delete clean.label
      delete clean.$schema
      componentSchemas[name] = clean
    }
    return { $ref: `#/components/schemas/${name}` }
  }

  const spec: any = {
    openapi: '3.0.3',
    info: {
      title: options.info?.title || 'API',
      version: options.info?.version || '1.0.0',
      ...(options.info?.description ? { description: options.info.description } : {}),
    },
    paths: {},
    components: { schemas: {}, securitySchemes: {} },
    tags: [],
  }

  if (options.servers) {
    // Drop entries whose URL can't be parsed by the browser's URL
    // constructor. Swagger UI runs `new URL(server.url)` on the client
    // and crashes with `Failed to construct 'URL': Invalid URL` if any
    // entry is malformed — which can happen on Windows dev when an
    // adapter hook populates servers with a path that was never meant
    // to be a URL. Relative URLs (e.g. '/') are allowed through.
    const validServers = options.servers.filter((s) => {
      if (!s?.url || typeof s.url !== 'string') return false
      if (s.url.startsWith('/')) return true
      try {
        new URL(s.url)
        return true
      } catch {
        return false
      }
    })
    if (validServers.length > 0) {
      spec.servers = validServers
    }
  }

  const allTags = new Set<string>()
  const securitySchemes: Record<string, any> = {}

  // Routes scoped to this adapter's config (when adapter passed itself
  // as the scope) plus the legacy default-scope bag (for direct
  // registerControllerForDocs callers without a scope arg).
  const scopedRoutes = getScopeBag(options as object)
  const defaultRoutes = options ? getScopeBag(DEFAULT_SCOPE) : []
  const routesToWalk =
    scopedRoutes.length > 0
      ? scopedRoutes
      : defaultRoutes /* fall back to legacy single-list when adapter didn't scope */

  for (const { controllerClass, mountPath } of routesToWalk) {
    // Skip excluded controllers
    if (hasClassMeta(SWAGGER_KEYS.EXCLUDE, controllerClass)) continue

    const routes: RouteDefinition[] = getClassMeta<RouteDefinition[]>(
      METADATA.ROUTES,
      controllerClass,
      [],
    )
    const classTags: string[] = getClassMeta<string[]>(SWAGGER_KEYS.TAGS, controllerClass, [])
    const classAuth: string | undefined = getClassMetaOrUndefined<string>(
      SWAGGER_KEYS.BEARER_AUTH,
      controllerClass,
    )
    for (const route of routes) {
      try {
        emitRouteOperation(route)
      } catch (err) {
        // One bad operation must not blank the whole docs page. Emit a
        // marker summary so the broken op shows up in Swagger UI with
        // a visible warning, and the rest of the spec stays valid.
        // Defensive resolution — the same fields that crashed inside
        // emit may still be undefined here.
        let openApiPath: string
        try {
          openApiPath = joinPaths(mountPath, route.path).replace(/:([a-zA-Z_]+)/g, '{$1}')
        } catch {
          openApiPath = `${mountPath}/__spec_error__`
        }
        const method = typeof route.method === 'string' ? route.method.toLowerCase() : 'get'
        if (!spec.paths[openApiPath]) spec.paths[openApiPath] = {}
        spec.paths[openApiPath][method] = {
          summary: `⚠ spec generation failed: ${err instanceof Error ? err.message : String(err)}`,
          responses: { default: { description: 'Spec generation failed for this operation.' } },
        }
      }
    }

    // Per-route emit hoisted to a closure so the try/catch above can
    // wrap each route in isolation. Closes over loop-locals (operation,
    // routes, classTags, classAuth, etc.) so the body reads the same
    // way it did before the wrap.
    function emitRouteOperation(route: RouteDefinition): void {
      // Skip excluded methods
      if (getMethodMetaOrUndefined(SWAGGER_KEYS.EXCLUDE, controllerClass, route.handlerName)) return

      // Build the full path — mountPath is the actual Express mount prefix (from onRouteMount),
      // and route.path is the method-level path. @Controller path is not included here
      // because buildRoutes does not bake it into the router.
      const fullPath = joinPaths(mountPath, route.path)

      // Convert Express :param to OpenAPI {param}
      const openApiPath = fullPath.replace(/:([a-zA-Z_]+)/g, '{$1}')
      const method = route.method.toLowerCase()

      // Gather metadata
      const operation: ApiOperationOptions = getMethodMeta<ApiOperationOptions>(
        SWAGGER_KEYS.OPERATION,
        controllerClass,
        route.handlerName,
        {} as ApiOperationOptions,
      )
      const responses: ApiResponseOptions[] = getMethodMeta<ApiResponseOptions[]>(
        SWAGGER_KEYS.RESPONSES,
        controllerClass,
        route.handlerName,
        [],
      )
      const methodTags: string[] = getMethodMeta<string[]>(
        SWAGGER_KEYS.TAGS,
        controllerClass,
        route.handlerName,
        [],
      )
      const methodAuth: string | undefined = getMethodMetaOrUndefined<string>(
        SWAGGER_KEYS.BEARER_AUTH,
        controllerClass,
        route.handlerName,
      )

      // Tags — method level overrides class level
      const tags = methodTags.length > 0 ? methodTags : classTags
      tags.forEach((t) => allTags.add(t))

      // Build operation object
      const op: any = {
        ...(tags.length > 0 ? { tags } : {}),
        ...(operation.summary ? { summary: operation.summary } : {}),
        ...(operation.description ? { description: operation.description } : {}),
        ...(operation.operationId ? { operationId: operation.operationId } : {}),
        ...(operation.deprecated ? { deprecated: true } : {}),
        parameters: [],
        responses: {},
      }

      // Path parameters
      const paramMatches = fullPath.match(/:([a-zA-Z_]+)/g) || []
      for (const match of paramMatches) {
        const paramName = match.slice(1)
        let schema: any = { type: 'string' }

        // Try to get type from params validation schema
        if (route.validation?.params) {
          const jsonSchema = toJsonSchema(route.validation.params)
          if (jsonSchema?.properties && typeof jsonSchema.properties === 'object') {
            const props = jsonSchema.properties as Record<string, any>
            if (props[paramName]) {
              schema = props[paramName]
            }
          }
        }

        op.parameters.push({
          name: paramName,
          in: 'path',
          required: true,
          schema,
        })
      }

      // Query parameters
      if (route.validation?.query) {
        const jsonSchema = toJsonSchema(route.validation.query)
        if (jsonSchema?.properties && typeof jsonSchema.properties === 'object') {
          const required = Array.isArray(jsonSchema.required) ? jsonSchema.required : []
          for (const [name, propSchema] of Object.entries(
            jsonSchema.properties as Record<string, any>,
          )) {
            op.parameters.push({
              name,
              in: 'query',
              required: required.includes(name),
              schema: propSchema,
            })
          }
        }
      }

      // @ApiQueryParams decorator — document filterable/sortable/searchable fields
      const queryParamsConfig = getMethodMetaOrUndefined<any>(
        METADATA.QUERY_PARAMS,
        controllerClass,
        route.handlerName,
      )
      if (queryParamsConfig) {
        if (queryParamsConfig.filterable?.length) {
          op.parameters.push({
            name: 'filter',
            in: 'query',
            required: false,
            description: `Filter fields: ${queryParamsConfig.filterable.join(', ')}. Format: \`field:operator:value\`. Operators: eq, neq, gt, gte, lt, lte, contains, starts, ends, in, between`,
            schema: { type: 'array', items: { type: 'string' } },
            style: 'form',
            explode: true,
          })
        }
        if (queryParamsConfig.sortable?.length) {
          op.parameters.push({
            name: 'sort',
            in: 'query',
            required: false,
            description: `Sort fields: ${queryParamsConfig.sortable.join(', ')}. Format: \`field:asc\` or \`field:desc\``,
            schema: { type: 'array', items: { type: 'string' } },
            style: 'form',
            explode: true,
          })
        }
        if (queryParamsConfig.searchable?.length) {
          op.parameters.push({
            name: 'q',
            in: 'query',
            required: false,
            description: `Search across: ${queryParamsConfig.searchable.join(', ')}`,
            schema: { type: 'string' },
          })
        }
        op.parameters.push(
          {
            name: 'page',
            in: 'query',
            required: false,
            description: 'Page number (default: 1)',
            schema: { type: 'integer', minimum: 1, default: 1 },
          },
          {
            name: 'limit',
            in: 'query',
            required: false,
            description: 'Items per page (default: 20, max: 100)',
            schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
          },
        )
      }

      // Remove empty parameters array
      if (op.parameters.length === 0) delete op.parameters

      // Request body
      if (route.validation?.body && ['post', 'put', 'patch'].includes(method)) {
        const bodySchema = toJsonSchema(route.validation.body)
        if (bodySchema) {
          const bodyName = route.validation.name || `${route.handlerName}Body`
          const ref = registerSchema(bodySchema, bodyName)
          op.requestBody = {
            required: true,
            content: { 'application/json': { schema: ref } },
          }
        }
      }

      // File upload detection
      const fileUpload = getMethodMetaOrUndefined<any>(
        METADATA.FILE_UPLOAD,
        controllerClass,
        route.handlerName,
      )
      if (fileUpload) {
        const fieldName = fileUpload.fieldName ?? 'file'
        const properties: any = {}

        if (fileUpload.mode === 'array') {
          properties[fieldName] = {
            type: 'array',
            items: { type: 'string', format: 'binary' },
          }
        } else if (fileUpload.mode !== 'none') {
          properties[fieldName] = {
            type: 'string',
            format: 'binary',
          }
        }

        op.requestBody = {
          required: true,
          content: {
            'multipart/form-data': {
              schema: { type: 'object', properties },
            },
          },
        }
      }

      // Responses
      if (responses.length > 0) {
        for (const resp of responses) {
          op.responses[String(resp.status)] = {
            description: resp.description || '',
            ...(resp.schema
              ? (() => {
                  const converted =
                    typeof resp.schema === 'function' || typeof resp.schema === 'object'
                      ? toJsonSchema(resp.schema)
                      : null
                  const schemaName = resp.name || `${route.handlerName}Response${resp.status}`
                  const finalSchema = converted
                    ? registerSchema(converted, schemaName)
                    : typeof resp.schema === 'object'
                      ? resp.schema
                      : undefined
                  return finalSchema
                    ? { content: { 'application/json': { schema: finalSchema } } }
                    : {}
                })()
              : {}),
          }
        }
      } else {
        // Auto-generate default responses
        const defaultStatus = method === 'post' ? '201' : method === 'delete' ? '204' : '200'
        op.responses[defaultStatus] = { description: 'Successful operation' }

        if (route.validation?.body) {
          op.responses['422'] = { description: 'Validation error' }
        }
      }

      // Security — check Swagger @BearerAuth() first, then fall back to
      // @forinda/kickjs-auth decorators (@Authenticated, @Public, @Roles)
      const authName = methodAuth || classAuth
      const isPublicRoute = isAuthPublic(controllerClass, route.handlerName)
      const isAuthRequired =
        authName ||
        isAuthAuthenticated(controllerClass, route.handlerName) ||
        isAuthAuthenticated(controllerClass)

      if (!isPublicRoute && isAuthRequired) {
        const schemeName = authName || 'BearerAuth'
        op.security = [{ [schemeName]: [] }]
        securitySchemes[schemeName] = securitySchemes[schemeName] || {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        }
      }

      // Mount
      if (!spec.paths[openApiPath]) spec.paths[openApiPath] = {}
      spec.paths[openApiPath][method] = op
    }
  }

  // Finalize
  spec.tags = Array.from(allTags).map((name) => ({ name }))
  spec.components.securitySchemes = securitySchemes

  if (options.bearerAuth) {
    if (!securitySchemes.BearerAuth) {
      spec.components.securitySchemes.BearerAuth = {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
      }
    }
    spec.security = [{ BearerAuth: [] }]
  }

  // Merge collected schemas into components
  spec.components.schemas = componentSchemas

  // Clean up empty components
  if (Object.keys(spec.components.schemas).length === 0) delete spec.components.schemas
  if (Object.keys(spec.components.securitySchemes).length === 0)
    delete spec.components.securitySchemes
  if (Object.keys(spec.components).length === 0) delete spec.components

  return spec
}
