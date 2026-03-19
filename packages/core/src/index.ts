import 'reflect-metadata'

// DI Container
export { Container } from './container'

// Interfaces & Constants
export {
  Scope,
  METADATA,
  TRANSACTION_MANAGER,
  type Constructor,
  type ServiceOptions,
  type BeanOptions,
  type TransactionManager,
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
  Transactional,
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
  Builder,
  type RouteDefinition,
  type MiddlewareHandler,
  type FileUploadConfig,
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

// Logger
export { Logger, createLogger, rootLogger, logger } from './logger'

// Errors
export { HttpException, type ValidationError } from './errors'
