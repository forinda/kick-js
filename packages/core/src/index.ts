import 'reflect-metadata'

// DI Container
export { Container } from './container'

// Interfaces & Constants
export {
  Scope,
  METADATA,
  type Constructor,
  type ServiceOptions,
  type BeanOptions,
  type BuilderOf,
  type Buildable,
} from './interfaces'

// Decorators
export {
  Injectable,
  Service,
  Component,
  Repository,
  Configuration,
  Controller,
  Bean,
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
} from './decorators'

// Module System
export { type AppModule, type AppModuleClass, type ModuleRoutes } from './app-module'

// Adapter System
export {
  type AppAdapter,
  type AppAdapterClass,
  type AdapterMiddleware,
  type MiddlewarePhase,
} from './adapter'

// Plugin System
export { type KickPlugin } from './plugin'

// Cron
export { Cron, getCronJobs, type CronJobMeta, CRON_META } from './cron'

// Cache
export { Cacheable, CacheEvict, type CacheOptions } from './cache'

// Logger
export { Logger, createLogger, rootLogger, logger } from './logger'

// Errors
export { HttpException, type ValidationError } from './errors'

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
