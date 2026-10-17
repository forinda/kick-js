// Application
export {
  APPLICATION,
  Application,
  type ApplicationOptions,
  type MiddlewareEntry,
  type ServerOptions,
  type ConfigDescription,
  type MountedRouteInfo,
} from './application'
export type { StartupStep, StartupTimelineSnapshot } from './startup-timeline'
export { evaluatePreconditions, type ConditionalOutcome, type Validators } from './conditional'
export {
  ROUTE_URLS,
  type RouteName,
  type UrlBuilder,
  type UrlForArgs,
  type UrlQuery,
} from './url-for'
export {
  defineCheck,
  StartupCheckError,
  type CheckContext,
  type CheckMessage,
  type StartupCheck,
} from './startup-checks'

// Bootstrap — zero-boilerplate entry point
export { bootstrap } from './bootstrap'

// Request Context
export {
  RequestContext,
  type ContextMeta,
  type Ctx,
  type RouteShape,
  type SseHandler,
} from './context'

// Return-value handlers — `return reply(201, body)` / plain returns auto-send
export {
  reply,
  isReply,
  applyHandlerResult,
  RESPOND,
  isRespondable,
  type Reply,
  type ReplyHeaders,
  type ReplyOptions,
  type Respondable,
  type InferHandlerResponse,
} from './reply'
export { defineHttpContextDecorator } from './define-http-context-decorator'
export type { TypedParsedQuery, FieldsOf } from './query'

// Router Builder — engine-neutral route table + the default Express materializer
export { buildRouteTable } from './router-builder'
export type { BuildRoutesOptions } from './router-builder'
export { buildRoutes, materializeRouter, expressRuntime } from './runtimes/express'

// HTTP runtime seam
export type {
  HttpRuntime,
  AdapterHttp,
  RuntimeResponse,
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
  KickRuntimeRegister,
  ActiveRuntime,
} from './runtime'
export type {
  ConnectRequest,
  ConnectResponse,
  ConnectNext,
  ConnectHandler,
  ConnectErrorHandler,
} from './connect'

// Middleware
export { requestId, REQUEST_ID_HEADER } from './middleware/request-id'
export {
  validate,
  defaultValidationError,
  type ValidationFailure,
  type ValidationErrorFactory,
} from './middleware/validate'
export { notFoundHandler, errorHandler } from './middleware/error-handler'
export { csrf, csrfGuard, type CsrfOptions, type CsrfGuardOptions } from './middleware/csrf'
export {
  requestLogger,
  type RequestLoggerOptions,
  type LoggedRequest,
  type LoggedResponse,
} from './middleware/request-logger'
export { helmet, type HelmetOptions } from './middleware/helmet'
export { allowedHosts, type AllowedHostsOptions } from './middleware/allowed-hosts'
export { breachPadding, type BreachPaddingOptions } from './middleware/breach-padding'
export { cors, type CorsOptions } from './middleware/cors'
export { rateLimit, type RateLimitOptions, type RateLimitStore } from './middleware/rate-limit'
export { rateLimitGuard, type RateLimitGuardOptions } from './middleware/rate-limit-guard'
export {
  KvRateLimitStore,
  KvSessionStore,
  type KvLike,
  type KvRateLimitStoreOptions,
  type KvSessionStoreOptions,
} from './middleware/kv-stores'
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
  type UploadedFile,
  type UploadStorageEngine,
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
  type CursorValue,
  type CursorPosition,
  type CursorQuery,
  type CursorPaginateOptions,
  type CursorPaginatedResponse,
  type ParseQueryOptions,
  type QueryRejection,
  type QueryRejectReason,
} from './query'
