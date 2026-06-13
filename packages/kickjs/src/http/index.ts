// Application
export { Application, type ApplicationOptions, type MiddlewareEntry } from './application'

// Bootstrap — zero-boilerplate entry point
export { bootstrap } from './bootstrap'

// Request Context
export { RequestContext, type ContextMeta, type Ctx, type RouteShape } from './context'
export { defineHttpContextDecorator } from './define-http-context-decorator'
export type { TypedParsedQuery, FieldsOf } from './query'

// Router Builder — engine-neutral route table + the default Express materializer
export { buildRouteTable } from './router-builder'
export type { BuildRoutesOptions } from './router-builder'
export { buildRoutes, materializeRouter, expressRuntime } from './runtimes/express'

// HTTP runtime seam (spec: docs/http/spec-http-runtimes.md)
export type {
  HttpRuntime,
  AdapterHttp,
  RouteEntry,
  RouteMeta,
  RouteTable,
  RouteMethod,
  CtxHandler,
  ConnectMiddleware,
  RuntimeAppOptions,
  RuntimeCapabilities,
  UseConnectOptions,
  RuntimeTypeMap,
  ExpressRuntimeTypes,
  KickRuntimeRegister,
  ActiveRuntime,
} from './runtime'

// Middleware
export { requestId, REQUEST_ID_HEADER } from './middleware/request-id'
export { validate } from './middleware/validate'
export { notFoundHandler, errorHandler } from './middleware/error-handler'
export { csrf, type CsrfOptions } from './middleware/csrf'
export { requestLogger, type RequestLoggerOptions } from './middleware/request-logger'
export { helmet, type HelmetOptions } from './middleware/helmet'
export { cors, type CorsOptions } from './middleware/cors'
export { rateLimit, type RateLimitOptions, type RateLimitStore } from './middleware/rate-limit'
export {
  session,
  type SessionOptions,
  type SessionStore,
  type SessionData,
  type Session,
} from './middleware/session'
export {
  upload,
  cleanupFiles,
  resolveMimeTypes,
  buildUploadMiddleware,
  type UploadOptions,
} from './middleware/upload'

// Query String Parsing
export {
  parseQuery,
  parseFilters,
  parseSort,
  parsePagination,
  parseSearchQuery,
  buildQueryParams,
  setQueryParsingDefaults,
  getQueryParsingDefaults,
  resetQueryParsingDefaults,
  FILTER_OPERATORS,
  type FilterOperator,
  type FilterItem,
  type SortItem,
  type PaginationParams,
  type ParsedQuery,
  type QueryFieldConfig,
  type QueryBuilderAdapter,
  type PaginatedResponse,
  type ParseQueryOptions,
  type QueryRejection,
  type QueryRejectReason,
} from './query'
