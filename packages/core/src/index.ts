import 'reflect-metadata'

// DI Container
export { Container } from './container'

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
export { Logger, createLogger, rootLogger, logger } from './logger'

// Errors
export { HttpException, HttpStatus, type HttpStatusCode, type ValidationError } from './errors'

// Path utilities
export { normalizePath, joinPaths } from './path'

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
