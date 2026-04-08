/**
 * @forinda/kickjs — unified KickJS framework package.
 *
 * Exports everything from core (DI, decorators, logger) and
 * http (Express app, middleware, RequestContext, routing).
 */

// ── Core ────────────────────────────────────────────────────────────────
export * from './core'

// ── HTTP ────────────────────────────────────────────────────────────────
export { Application, type ApplicationOptions, type MiddlewareEntry } from './http/application'

export { bootstrap } from './http/bootstrap'

// Cluster
export { isClusterPrimary, type ClusterOptions } from './http/cluster'

export { RequestContext, type Ctx, type RouteShape } from './http/context'

export { buildRoutes, getControllerPath } from './http/router-builder'

// Request-Scoped DI
export { requestStore, getRequestStore, type RequestStore } from './http/request-store'
export { requestScopeMiddleware } from './http/middleware/request-scope'

// Middleware
export { requestId, REQUEST_ID_HEADER } from './http/middleware/request-id'
export { validate } from './http/middleware/validate'
export { notFoundHandler, errorHandler } from './http/middleware/error-handler'
export { csrf, type CsrfOptions } from './http/middleware/csrf'
export { requestLogger, type RequestLoggerOptions } from './http/middleware/request-logger'
export { helmet, type HelmetOptions } from './http/middleware/helmet'
export { cors, type CorsOptions } from './http/middleware/cors'
export { rateLimit, type RateLimitOptions, type RateLimitStore } from './http/middleware/rate-limit'
export {
  session,
  type SessionOptions,
  type SessionStore,
  type SessionData,
  type Session,
} from './http/middleware/session'
export {
  upload,
  cleanupFiles,
  resolveMimeTypes,
  buildUploadMiddleware,
  type UploadOptions,
} from './http/middleware/upload'

// Trace Context (W3C traceparent propagation)
export {
  traceContext,
  parseTraceparent,
  TRACEPARENT_HEADER,
  type TraceContextOptions,
  type TraceContext,
} from './http/middleware/trace-context'

// Query String Parsing
export {
  parseQuery,
  parseFilters,
  parseSort,
  parsePagination,
  parseSearchQuery,
  buildQueryParams,
  FILTER_OPERATORS,
  type FilterOperator,
  type FilterItem,
  type SortItem,
  type PaginationParams,
  type ParsedQuery,
  type TypedParsedQuery,
  type FieldsOf,
  type QueryFieldConfig,
  type QueryBuilderAdapter,
  type PaginatedResponse,
} from './http/query'

// View & SPA Adapters
export { ViewAdapter, type ViewAdapterOptions } from './http/middleware/views'
export { SpaAdapter, type SpaAdapterOptions } from './http/middleware/spa'

// ── Config (env validation + ConfigService) ────────────────────────────
// Formerly published as `@forinda/kickjs-config`. Lives here now; the
// standalone package will be removed in v3.
//
// NOTE: We do NOT re-export `type Env` from `./config` here, even though
// the standalone package used to. `core/decorators` already exports a
// generic `Env<K extends EnvKey>` helper that user code uses with
// `@Value('FOO') x!: Env<'FOO'>` — barrel-merging the two would
// shadow the generic with the concrete `z.infer<typeof baseEnvSchema>`
// alias and break every existing typed `@Value` site. Apps that need
// the base shape can still pull it from `@forinda/kickjs/config` or
// derive it inline via `z.infer<typeof baseEnvSchema>`.
export {
  baseEnvSchema,
  defineEnv,
  loadEnv,
  getEnv,
  reloadEnv,
  resetEnvCache,
  ConfigService,
  createConfigService,
  type TypedConfigService,
} from './config'
