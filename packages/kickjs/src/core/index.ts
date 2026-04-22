import 'reflect-metadata'

// DI Container
export {
  Container,
  tokenName,
  type ContainerChangeEvent,
  type ContainerChangeListener,
  type KickJsRegistry,
} from './container'

// Type-safe injection tokens
export { createToken, isInjectionToken, INJECTION_TOKEN, type InjectionToken } from './token'

// Interfaces & Constants
export {
  Scope,
  METADATA,
  type Constructor,
  type ServiceOptions,
  type BuilderOf,
  type Buildable,
  type MaybePromise,
  type ClassKind,
  type PostConstructStatus,
} from './interfaces'

// Decorators
export {
  Injectable,
  Service,
  Component,
  Repository,
  Controller,
  PostConstruct,
  Autowired,
  Inject,
  Value,
  Get,
  Post,
  Put,
  Delete,
  Patch,
  Middleware,
  FileUpload,
  ApiQueryParams,
  Builder,
  type RouteDefinition,
  type MiddlewareHandler,
  type FileUploadConfig,
  type FileTypeFilter,
  type BaseUploadOptions,
  type ApiQueryParamsConfig,
  type ApiQueryParamsConfig as QueryParamsConfig,
  type ColumnApiQueryParamsConfig,
  type EnvKey,
  type Env,
  normalizeApiQueryParamsConfig,
} from './decorators'

// Module System
export { type AppModule, type AppModuleClass, type ModuleRoutes } from './app-module'

// Adapter System
export {
  type AppAdapter,
  type AppAdapterClass,
  type AdapterContext,
  type AdapterMiddleware,
  type MiddlewarePhase,
} from './adapter'

// Plugin System
export { type KickPlugin } from './plugin'

// Cron
export { Cron, getCronJobs, type CronJobMeta, CRON_META } from './cron'

// Cache
export {
  Cacheable,
  CacheEvict,
  setCacheProvider,
  getCacheProvider,
  MemoryCacheProvider,
  type CacheProvider,
  type CacheOptions,
} from './cache'

// Logger
export {
  Logger,
  createLogger,
  rootLogger,
  logger,
  ConsoleLoggerProvider,
  type LoggerProvider,
} from './logger'

// Errors
export { HttpException, HttpStatus, type HttpStatusCode, type ValidationError } from './errors'

// Path utilities
export { normalizePath, joinPaths } from './path'

// Metadata utilities
export {
  setClassMeta,
  setMethodMeta,
  getClassMeta,
  getMethodMeta,
  hasClassMeta,
  getClassMetaOrUndefined,
  getMethodMetaOrUndefined,
  pushClassMeta,
  pushMethodMeta,
  setInMetaMap,
  getMetaMap,
  setInMetaRecord,
  getMetaRecord,
} from './metadata'

// Circuit Breaker
export {
  CircuitBreaker,
  CircuitOpenError,
  type CircuitBreakerOptions,
  type CircuitBreakerState,
  type CircuitBreakerStats,
} from './circuit-breaker'

// Reactivity
export {
  ref,
  computed,
  watch,
  reactive,
  isRef,
  unref,
  toRefs,
  type Ref,
  type ComputedRef,
  type WatchOptions,
} from './reactivity'

// Execution Context (transport-agnostic)
export { type ContextMeta, type MetaValue, type ExecutionContext } from './execution-context'

// Context Contributor pipeline (#107) — Phase 1: types + factory only.
// Topo-sort, runner, and HTTP integration land in Phases 2 and 4.
export {
  defineContextDecorator,
  type ContextDecoratorSpec,
  type ContributorRegistration,
  type ContextDecorator,
  type ResolvedDeps,
} from './context-decorator'

export {
  MissingContributorError,
  ContributorCycleError,
  DuplicateContributorError,
} from './context-errors'

// Phase 2 — pipeline builder + topo-sort + validation.
export {
  buildPipeline,
  type ContributorSource,
  type SourcedRegistration,
  type ContributorPipeline,
  type BuildPipelineOptions,
} from './contributor-pipeline'

// Phase 2 — sequential async runner with the §20.9 error matrix.
export { runContributors, type RunContributorsOptions } from './contributor-runner'

// Plugin/adapter dependsOn topo-sort (architecture.md §21.2.1).
export {
  mountSort,
  DuplicateMountNameError,
  MissingMountDepError,
  MountCycleError,
  type MountSortItem,
  type MountKind,
} from './mount-sort'

// Plugin/adapter factories (architecture.md §21.2.2 + §21.3.1 + §21.3.4).
export {
  definePlugin,
  type DefinePluginOptions,
  type PluginAsyncOptions,
  type PluginFactory,
  type BuildContext,
} from './define-plugin'

export {
  defineAdapter,
  type DefineAdapterOptions,
  type AdapterAsyncOptions,
  type AdapterFactory,
} from './define-adapter'

// Augmentation registry (architecture.md §21.3.3) and typegen-narrowed
// `dependsOn` (architecture.md §21.2.1).
export {
  defineAugmentation,
  type KickJsPluginRegistry,
  type KickJsPluginName,
  type AugmentationMeta,
} from './augmentation'
