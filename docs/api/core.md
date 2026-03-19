# @kickjs/core

Inversion-of-Control container, decorators, logger, and error types shared by all KickJS packages.

## Container

Singleton IoC container managing dependency registration, resolution, and lifecycle.

```typescript
class Container {
  static getInstance(): Container
  static reset(): void
  register(token: any, target: Constructor, scope?: Scope): void
  registerFactory(token: any, factory: () => any, scope?: Scope): void
  registerInstance(token: any, instance: any): void
  resolve<T = any>(token: any): T
  has(token: any): boolean
  bootstrap(): void
}
```

## Decorators

### Class Decorators

```typescript
function Injectable(options?: ServiceOptions): ClassDecorator
function Service(options?: ServiceOptions): ClassDecorator
function Component(options?: ServiceOptions): ClassDecorator
function Repository(options?: ServiceOptions): ClassDecorator
function Configuration(): ClassDecorator
function Controller(path?: string): ClassDecorator
```

- **Injectable / Service / Component / Repository** -- Register a class in the container. Semantic aliases with identical behavior.
- **Configuration** -- Marks a class whose `@Bean` methods produce factory-registered dependencies.
- **Controller** -- Registers a class and attaches an HTTP route prefix.

### Method Decorators

```typescript
function Bean(options?: BeanOptions): MethodDecorator
function PostConstruct(): MethodDecorator
function Transactional(): MethodDecorator
```

- **Bean** -- Inside a `@Configuration` class, registers the method's return value as a dependency.
- **PostConstruct** -- Called once after the instance is fully constructed and injected.
- **Transactional** -- Wraps the method in a begin/commit/rollback transaction cycle.

### Property and Parameter Decorators

```typescript
function Autowired(token?: any): PropertyDecorator
function Inject(token: any): ParameterDecorator
function Value(envKey: string, defaultValue?: any): PropertyDecorator
```

- **Autowired** -- Lazy property injection resolved from the container.
- **Inject** -- Explicit token override for constructor parameter injection.
- **Value** -- Injects an environment variable, evaluated lazily at access time.

### HTTP Route Decorators

```typescript
function Get(path?: string, validation?: RouteValidation): MethodDecorator
function Post(path?: string, validation?: RouteValidation): MethodDecorator
function Put(path?: string, validation?: RouteValidation): MethodDecorator
function Delete(path?: string, validation?: RouteValidation): MethodDecorator
function Patch(path?: string, validation?: RouteValidation): MethodDecorator
```

### Middleware and Upload Decorators

```typescript
function Middleware(...handlers: MiddlewareHandler[]): ClassDecorator & MethodDecorator
function FileUpload(config: FileUploadConfig): MethodDecorator
function Builder(target: any): void
```

- **Middleware** -- Attach middleware at class or method level.
- **FileUpload** -- Configure file upload handling for a route handler.
- **Builder** -- Adds a static `builder()` method for fluent object construction.

## Types

```typescript
enum Scope { SINGLETON = 'singleton', TRANSIENT = 'transient' }

type Constructor<T = any> = new (...args: any[]) => T

interface ServiceOptions { scope?: Scope }
interface BeanOptions { scope?: Scope }

interface RouteDefinition {
  method: string; path: string; handlerName: string
  validation?: { body?: any; query?: any; params?: any }
}

type MiddlewareHandler = (ctx: any, next: () => void) => void | Promise<void>

interface FileUploadConfig {
  mode: 'single' | 'array' | 'none'
  fieldName?: string; maxCount?: number
  maxSize?: number; allowedMimeTypes?: string[]
}

interface TransactionManager<TTx = unknown> {
  begin(): Promise<TTx>
  commit(tx: TTx): Promise<void>
  rollback(tx: TTx): Promise<void>
}

type BuilderOf<T> = {
  [K in keyof T as T[K] extends Function ? never : K]-?: (value: T[K]) => BuilderOf<T>
} & { build(): T }

interface Buildable<T> { builder(): BuilderOf<T> }
```

## AppModule

Interface every feature module must implement.

```typescript
interface AppModule {
  register(container: Container): void
  routes(): ModuleRoutes | ModuleRoutes[]
}

type AppModuleClass = new () => AppModule

interface ModuleRoutes {
  path: string; router: any; version?: number; controller?: any
}
```

## AppAdapter

Lifecycle hooks for plugging in cross-cutting concerns (database, docs, rate limiting).

```typescript
interface AppAdapter {
  name?: string
  middleware?(): AdapterMiddleware[]
  beforeMount?(app: any, container: Container): void
  onRouteMount?(controllerClass: any, mountPath: string): void
  beforeStart?(app: any, container: Container): void
  afterStart?(server: any, container: Container): void
  shutdown?(): void | Promise<void>
}

type MiddlewarePhase = 'beforeGlobal' | 'afterGlobal' | 'beforeRoutes' | 'afterRoutes'

interface AdapterMiddleware {
  handler: any; phase?: MiddlewarePhase; path?: string
}
```

## Logger

Named logger built on pino with component context.

```typescript
class Logger {
  constructor(name?: string)
  static for(name: string): Logger
  child(name: string): Logger
  info(msg: string, ...args: any[]): void
  warn(msg: string, ...args: any[]): void
  error(msgOrObj: any, msg?: string, ...args: any[]): void
  debug(msg: string, ...args: any[]): void
  trace(msg: string, ...args: any[]): void
  fatal(msg: string, ...args: any[]): void
}

function createLogger(name: string): Logger
```

## HttpException

Typed HTTP error with static factories for common status codes.

```typescript
class HttpException extends Error {
  readonly status: number
  readonly details?: ValidationError[]

  constructor(status: number, message: string, details?: ValidationError[])

  static fromZodError(error: any, message?: string): HttpException
  static badRequest(message?: string): HttpException
  static unauthorized(message?: string): HttpException
  static forbidden(message?: string): HttpException
  static notFound(message?: string): HttpException
  static conflict(message?: string): HttpException
  static unprocessable(message?: string, details?: ValidationError[]): HttpException
  static tooManyRequests(message?: string): HttpException
  static internal(message?: string): HttpException
}

interface ValidationError { field: string; message: string; code?: string }
```
