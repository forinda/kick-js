/**
 * @forinda/kickjs — unified KickJS framework package.
 *
 * Exports everything from core (DI, decorators, logger) and
 * http (Express app, middleware, RequestContext, routing).
 */

// ── Core ────────────────────────────────────────────────────────────────
export * from './core'

// ── HTTP ────────────────────────────────────────────────────────────────
export {
  APPLICATION,
  Application,
  type ApplicationOptions,
  type MiddlewareEntry,
  type ServerOptions,
  type ConfigDescription,
  type ConfigOrigins,
  type MountedRouteInfo,
} from './http/application'
export type { FailureAdvice } from './core/failure-analysis'
export {
  defineSettings,
  loadSettings,
  originsOf,
  type ConfigVar,
  type ProvidedSettings,
  type Settings,
  type SettingsDeclaration,
  type SettingsOf,
  type ValueOrigin,
  type VarOrigin,
} from './config/settings'
export {
  allOf,
  onEnv,
  onPackage,
  type AdapterCondition,
  type ConditionOutcome,
} from './core/adapter-conditions'
export type { StartupStep, StartupTimelineSnapshot } from './http/startup-timeline'
export { evaluatePreconditions, type ConditionalOutcome, type Validators } from './http/conditional'
export {
  ROUTE_URLS,
  type RouteName,
  type UrlBuilder,
  type UrlForArgs,
  type UrlQuery,
} from './http/url-for'
export { metricsAdapter, RequestHistogram, type MetricsOptions } from './http/metrics'
export {
  defineCheck,
  StartupCheckError,
  type CheckContext,
  type CheckMessage,
  type StartupCheck,
} from './http/startup-checks'
export { waitUntil, settleBackgroundWork, type PlatformContext } from './http/background'
export { RAW_BODY } from './http/body-policy'
export {
  reportError,
  reportResponse,
  type ErrorInfo,
  type ErrorSource,
  type ResponseInfo,
} from './core/observers'
export { KickCronAdapter, CRON_WORKER_ENV, type CronAdapterOptions } from './http/cron-adapter'
export {
  HANDLER_CHANNEL,
  ERROR_CHANNEL,
  RESPONSE_CHANNEL,
  type HandlerTraceContext,
} from './http/tracing'
export {
  healthModule,
  HealthController,
  HEALTH_PROBE,
  type HealthProbe,
  type HealthCheckResult,
  type HealthModuleConfig,
} from './http/health-module'

export { bootstrap } from './http/bootstrap'
export { createHandler, type KickHandler } from './http/handler'

// Cluster
export { isClusterPrimary, type ClusterOptions } from './http/cluster'

export {
  RequestContext,
  type Ctx,
  type RouteShape,
  type DeepReadonly,
  type SseHandler,
} from './http/context'
export { defineHttpContextDecorator } from './http/define-http-context-decorator'
export { assertFlagTest, defineRouteFlag, getRouteFlags, matchesFlagTest } from './core/route-flag'
export { bindRoutePolicy, type RoutePolicyTable } from './core/route-policy'
export {
  hashPassword,
  verifyPassword,
  type PasswordCheck,
  type PasswordHashOptions,
  type LegacyHasher,
  type VerifyPasswordOptions,
} from './core/password'
export { matchesBearer } from './core/web-crypto'
export {
  createSigner,
  type SignedCheck,
  type Signer,
  type SignerOptions,
  type VerifyOptions,
} from './core/signing'
export type {
  KickRouteFlags,
  BareRouteFlag,
  RouteFlag,
  ValuedRouteFlag,
  RouteFlagContext,
  NegatedRouteFlagName,
  RouteFlagName,
  RouteFlagDeclarations,
  RouteFlagPredicate,
  RouteFlagRecord,
  RouteFlagTest,
  RouteFlagValue,
  RouteFlags,
} from './core/route-flag'
export type { MatchedRoute, RouteContributor } from './http/runtime'

// Return-value handlers + response inference
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
} from './http/reply'

export { buildRouteTable } from './http/router-builder'
export type { BuildRoutesOptions } from './http/router-builder'
export { buildRoutes, materializeRouter, expressRuntime } from './http/runtimes/express'
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
} from './http/runtime'
export type {
  ConnectRequest,
  ConnectResponse,
  ConnectNext,
  ConnectHandler,
  ConnectErrorHandler,
} from './http/connect'

// Request-Scoped DI
export {
  requestStore,
  getRequestStore,
  getRequestValue,
  type RequestStore,
} from './http/request-store'
export { requestScopeMiddleware } from './http/middleware/request-scope'

// Middleware
export { requestId, REQUEST_ID_HEADER } from './http/middleware/request-id'
export {
  validate,
  defaultValidationError,
  type ValidationFailure,
  type ValidationErrorFactory,
} from './http/middleware/validate'
export { notFoundHandler, errorHandler } from './http/middleware/error-handler'
export { csrf, csrfGuard, type CsrfOptions, type CsrfGuardOptions } from './http/middleware/csrf'
export {
  requestLogger,
  type RequestLoggerOptions,
  type LoggedRequest,
  type LoggedResponse,
} from './http/middleware/request-logger'
export { helmet, type HelmetOptions } from './http/middleware/helmet'
export { allowedHosts, type AllowedHostsOptions } from './http/middleware/allowed-hosts'
export { breachPadding, type BreachPaddingOptions } from './http/middleware/breach-padding'
export { cors, type CorsOptions } from './http/middleware/cors'
export { rateLimit, type RateLimitOptions, type RateLimitStore } from './http/middleware/rate-limit'
export { rateLimitGuard, type RateLimitGuardOptions } from './http/middleware/rate-limit-guard'
export {
  KvRateLimitStore,
  KvSessionStore,
  type KvLike,
  type KvRateLimitStoreOptions,
  type KvSessionStoreOptions,
} from './http/middleware/kv-stores'
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
  type UploadedFile,
  type UploadStorageEngine,
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
  setQueryParsingDefaults,
  getQueryParsingDefaults,
  resetQueryParsingDefaults,
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
  type CursorValue,
  type CursorPosition,
  type CursorQuery,
  type CursorPaginateOptions,
  type CursorPaginatedResponse,
  type ParseQueryOptions,
  type QueryRejection,
  type QueryRejectReason,
} from './http/query'

// View & SPA Adapters
export { ViewAdapter, type ViewAdapterOptions } from './http/middleware/views'
export { SpaAdapter, type SpaAdapterOptions } from './http/middleware/spa'

// ── Config (env validation + ConfigService) ────────────────────────────
// Formerly published as `@forinda/kickjs-config` — that package was
// removed in v4. All env + ConfigService exports live here now.
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
  loadEnvFromSchema,
  getEnv,
  reloadEnv,
  withEnv,
  resetEnvCache,
  ConfigService,
  createConfigService,
  type TypedConfigService,
} from './config'
