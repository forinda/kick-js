# @forinda/kickjs-core

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
interface AdapterContext {
  app: any              // Express application
  container: Container  // DI container
  server?: any          // http.Server (only available in afterStart)
  env: string           // NODE_ENV (default: 'development')
  isProduction: boolean // true when NODE_ENV === 'production'
}

interface AppAdapter {
  name?: string
  middleware?(): AdapterMiddleware[]
  beforeMount?(ctx: AdapterContext): void
  onRouteMount?(controllerClass: any, mountPath: string): void
  beforeStart?(ctx: AdapterContext): void
  afterStart?(ctx: AdapterContext): void
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

### Logger.setProvider()

Replace the logging backend for all `Logger` instances. Every existing logger lazily picks up the new provider on its next log call.

```typescript
interface LoggerProvider {
  info(msg: string, ...args: any[]): void
  warn(msg: string, ...args: any[]): void
  error(msg: string, ...args: any[]): void
  debug(msg: string, ...args: any[]): void
  trace?(msg: string, ...args: any[]): void
  fatal?(msg: string, ...args: any[]): void
  /** Return a child provider scoped to the given component name */
  child(bindings: { component: string }): LoggerProvider
}

Logger.setProvider(provider: LoggerProvider): void
Logger.getProvider(): LoggerProvider
Logger.resetProvider(): void
```

- **setProvider** -- Replaces the active logging backend for all loggers. Clears the internal logger cache so subsequent `Logger.for()` calls use the new provider.
- **getProvider** -- Returns the currently active provider (useful for testing).
- **resetProvider** -- Reverts to the default pino-based provider. Intended for test teardown.

**Built-in providers:**

| Provider | Description |
| --- | --- |
| `PinoLoggerProvider` (default) | Delegates to the root pino instance with `pino-pretty` in development |
| `ConsoleLoggerProvider` | Uses `console.*` methods. Accepts an optional prefix string |

```typescript
import { Logger, ConsoleLoggerProvider } from '@forinda/kickjs'

// Switch all loggers to console output
Logger.setProvider(new ConsoleLoggerProvider())

const log = Logger.for('MyService')
log.info('Hello') // Output: [MyService] Hello

// Restore default pino backend (e.g. in afterEach)
Logger.resetProvider()
```

## CircuitBreaker

Protects your application from cascading failures when downstream services are unhealthy by short-circuiting requests after a configurable failure threshold.

The breaker transitions through three states: **closed** (normal operation), **open** (requests rejected), and **half_open** (limited probe requests allowed to test recovery).

```typescript
type CircuitBreakerState = 'closed' | 'open' | 'half_open'

interface CircuitBreakerOptions {
  /** Number of consecutive failures before the circuit opens */
  failureThreshold: number
  /** Milliseconds to wait before transitioning from OPEN to HALF_OPEN */
  resetTimeout: number
  /** Max requests allowed in HALF_OPEN state before deciding (default 1) */
  halfOpenMax?: number
}

interface CircuitBreakerStats {
  failures: number
  successes: number
  state: CircuitBreakerState
  lastFailure?: Date
}

class CircuitBreaker {
  readonly name: string
  constructor(name: string, options: CircuitBreakerOptions)
  execute<T>(fn: () => Promise<T>): Promise<T>
  getState(): CircuitBreakerState
  getStats(): CircuitBreakerStats
  reset(): void
}
```

- **execute** -- Run an async function through the breaker. Throws `CircuitOpenError` when the circuit is open.
- **getState** -- Returns the current state, auto-transitioning from `open` to `half_open` when the reset timeout has elapsed.
- **getStats** -- Returns current failure/success counters and state.
- **reset** -- Manually force the circuit back to `closed` and zero all counters.

### CircuitOpenError

Thrown by `execute()` when the circuit is open or the half-open probe limit has been reached.

```typescript
class CircuitOpenError extends Error {
  readonly breakerName: string
  constructor(breakerName: string)
}
```

### Usage

```typescript
import { CircuitBreaker, CircuitOpenError } from '@forinda/kickjs'

const breaker = new CircuitBreaker('payment-api', {
  failureThreshold: 5,
  resetTimeout: 30_000,
})

try {
  const result = await breaker.execute(() =>
    fetch('https://payment.example.com/charge'),
  )
} catch (err) {
  if (err instanceof CircuitOpenError) {
    // Fail fast — downstream service is unhealthy
  }
}
```

## Cluster Mode

Run multiple worker processes sharing the same port for multi-core utilization. The primary process forks workers and forwards SIGTERM/SIGINT signals. Dead workers are automatically restarted after a short delay.

```typescript
interface ClusterOptions {
  /** Number of worker processes (default: os.cpus().length) */
  workers?: number
}

function isClusterPrimary(): boolean
```

Enable cluster mode through the `bootstrap()` options:

```typescript
import { bootstrap } from '@forinda/kickjs'

// Use all available CPU cores
bootstrap({ modules, cluster: true })

// Use exactly 4 workers
bootstrap({ modules, cluster: { workers: 4 } })
```

When `cluster` is enabled and the current process is the primary:

1. The primary forks `workers` child processes (defaults to `os.cpus().length`).
2. Each worker calls `bootstrap()` independently and shares the port via Node's built-in `cluster` module (OS round-robin load balancing).
3. SIGTERM/SIGINT on the primary is forwarded to all workers.
4. Dead workers are restarted after a 1-second delay.

Use `isClusterPrimary()` to check if the current process is the primary (e.g. for one-time initialization tasks like database migrations).

## Health Endpoints

Built-in health check endpoints are mounted at the root path (outside the API prefix) before any middleware runs.

### GET /health/live

Liveness probe. Returns `200` with `{ status: 'ok', uptime }` when the server is running. Returns `503` with `{ status: 'draining', uptime }` when the application is shutting down.

### GET /health/ready

Readiness probe. Runs `onHealthCheck()` on every adapter that implements it and aggregates the results. Returns `200` with `{ status: 'ready', checks }` when all adapters report healthy. Returns `503` with `{ status: 'degraded', checks }` when any adapter is down. Returns `503` with `{ status: 'draining', checks: [] }` during shutdown.

```typescript
// Example adapter with health check
const dbAdapter: AppAdapter = {
  name: 'postgres',
  async onHealthCheck() {
    await pool.query('SELECT 1')
    return { name: 'postgres', status: 'up' }
  },
}
```

## Graceful Shutdown

The `Application` tracks in-flight requests and provides a graceful shutdown sequence that drains active connections before tearing down adapters.

```typescript
class Application {
  /** Whether the application is currently draining in-flight requests */
  get isDraining(): boolean
  /** Number of HTTP requests currently being processed */
  get inFlightRequests(): number
  /** Initiate graceful shutdown */
  shutdown(): Promise<void>
}
```

### Shutdown sequence

1. **Stop accepting connections** -- `server.close()` prevents new TCP connections.
2. **Drain in-flight requests** -- Waits for all active requests to complete their response (tracked via `finish`/`close` events).
3. **Run adapter and plugin shutdowns** -- Calls `shutdown()` on all registered adapters and plugins concurrently via `Promise.allSettled`.
4. **Force exit on timeout** -- If requests do not drain within `shutdownTimeout` (default 30 seconds), the shutdown proceeds anyway. Set to `0` to disable the forced timeout.

Safe to call multiple times -- subsequent calls are no-ops.

```typescript
import { bootstrap } from '@forinda/kickjs'

const app = await bootstrap({
  modules,
  shutdownTimeout: 15_000, // 15 seconds (default: 30_000)
})

// Trigger shutdown on SIGTERM (already wired by bootstrap, shown for clarity)
process.on('SIGTERM', () => app.shutdown())
```

During draining, the `/health/live` and `/health/ready` endpoints return `503` so load balancers can stop routing traffic to the instance.

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
