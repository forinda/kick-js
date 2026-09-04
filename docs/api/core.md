# @forinda/kickjs-core

Inversion-of-Control container, decorators, logger, and error types shared by all KickJS packages.

## bootstrap() options

`bootstrap(options)` (from `@forinda/kickjs`) is the application entry point. It takes an `ApplicationOptions` object — every field below. `modules` is the only required one; everything else has a safe default.

| Option            | Type                                  | Default                         | Description                                                                                                                                                      |
| ----------------- | ------------------------------------- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `modules`         | `AppModuleEntry[]`                    | **required**                    | Feature modules to load (class or `defineModule()` instance form).                                                                                               |
| `setup`           | `(registry) => void`                  | —                               | Imperative/conditional module registration; runs after plugins and the static `modules` array.                                                                   |
| `adapters`        | `AppAdapter[]`                        | `[]`                            | Lifecycle hooks (DB, Redis, Swagger, OTel…). Build with `defineAdapter()`.                                                                                       |
| `plugins`         | `KickPlugin[]`                        | `[]`                            | Bundles of modules + adapters + middleware + DI bindings. Build with `definePlugin()`.                                                                           |
| `contributors`    | `ContributorRegistrations`            | —                               | Global [context contributors](../guide/context-decorators.md) at `'global'` precedence.                                                                          |
| `runtime`         | `HttpRuntime`                         | `expressRuntime()`              | HTTP engine driver — `fastifyRuntime()` / `h3Runtime()` swap the engine. See [HTTP Runtimes](../guide/http-runtimes.md).                                         |
| `middlewares`     | `MiddlewareEntry[]`                   | `requestId()`, `express.json()` | Global middleware pipeline, in order. Replaces the default stack entirely when set.                                                                              |
| `port`            | `number`                              | `PORT` env, else `3000`         | Listen port.                                                                                                                                                     |
| `apiPrefix`       | `string`                              | `'/api'`                        | Global route prefix.                                                                                                                                             |
| `defaultVersion`  | `number \| false`                     | `1`                             | Routes mount at `/{prefix}/v{version}/{path}`. `false` drops the version segment — see [Opting out of versioning](../guide/modules.md#opting-out-of-versioning). |
| `trustProxy`      | `boolean \| number \| string \| fn`   | `false`                         | Express `trust proxy` setting.                                                                                                                                   |
| `jsonLimit`       | `string \| number`                    | `'1mb'`                         | Max JSON body size — only applied when `middlewares` is omitted.                                                                                                 |
| `security`        | `{ helmet?: boolean }`                | `{ helmet: true }`              | Auto-inject helmet headers unless opted out.                                                                                                                     |
| `health`          | `boolean \| { flags }`                | `true`                          | Mount the built-in [health module](#health-endpoints). `false` leaves `/health/*` to you; `{ flags: ['auth.public'] }` puts your own route flags on both probes. |
| `contextStore`    | `'auto' \| 'manual'`                  | `'auto'`                        | ALS frame for `RequestContext.set/get` + REQUEST-scoped DI. `'manual'` only if you own the frame.                                                                |
| `processHooks`    | `'auto' \| 'errors-only' \| 'manual'` | `'auto'`                        | Process-level error loggers + SIGINT/SIGTERM → shutdown. Use `'errors-only'` when an SDK owns shutdown.                                                          |
| `cluster`         | `boolean \| { workers?: number }`     | `false`                         | Fork workers across CPU cores (shared port).                                                                                                                     |
| `shutdownTimeout` | `number`                              | `30000`                         | Max ms to wait for graceful shutdown (0 disables forced exit).                                                                                                   |
| `logRouteTable`   | `boolean`                             | `false`                         | Log a per-controller route summary on startup (`info` level).                                                                                                    |
| `onNotFound`      | `(req, res, next) => void`            | built-in 404                    | Custom unmatched-route handler.                                                                                                                                  |
| `onError`         | `(err, req, res, next) => void`       | built-in                        | Custom global error handler (built-in formats ZodError / HttpException).                                                                                         |

Deprecated alias (kept for back-compat; the new name wins when both are set): `logRoutesTable` → `logRouteTable`. The `middleware` alias for `middlewares` was **removed in v8** — passing it is now a type error.

```ts
import { bootstrap, helmet, cors, requestId } from '@forinda/kickjs'
import { fastifyRuntime } from '@forinda/kickjs/fastify'

await bootstrap({
  modules: [HelloModule()],
  runtime: fastifyRuntime(),
  apiPrefix: '/api',
  defaultVersion: 1,
  middlewares: [requestId(), helmet(), cors()],
})
```

> Configuration that lives in `kick.config.ts` (CLI/codegen — pattern, runtime, typegen, db) is separate. See [KickConfig](../api/cli.md#kickconfig).

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
function Controller(): ClassDecorator
```

- **Injectable / Service / Component / Repository** -- Register a class in the container. Semantic aliases with identical behavior.
- **Configuration** -- Marks a class whose `@Bean` methods produce factory-registered dependencies.
- **Controller** -- Registers a class as an HTTP controller. The route prefix comes from the module's `routes().path`, not the decorator.

### Method Decorators

```typescript
function Bean(options?: BeanOptions): MethodDecorator
function PostConstruct(): MethodDecorator
function Transactional(): MethodDecorator
```

- **Bean** -- Inside a `@Configuration` class, registers the method's return value as a dependency.
- **PostConstruct** -- Called once after the instance is fully constructed and injected.
- **Transactional** -- Wraps the method in a begin/commit/rollback transaction cycle.

### Injection Decorators

```typescript
function Autowired(token?: any): PropertyOrParameterDecorator
function Inject(token?: any): PropertyOrParameterDecorator
function Value(envKey: string, defaultValue?: any): PropertyDecorator
```

`@Autowired` and `@Inject` are interchangeable — same runtime, same types, two names. Each works in two positions:

```typescript
@Service()
class UserRepo {
  // Property position.
  @Autowired(DB) private db!: KickDbClient

  // Or constructor-parameter position — same decorator works here too.
  constructor(@Inject(LOGGER) private logger: Logger) {}
}
```

Calling without an explicit token resolves via the property type / constructor parameter type emitted by `emitDecoratorMetadata`:

```typescript
class UserRepo {
  @Autowired() private db!: KickDbClient // resolved by type
}
```

- **Autowired / Inject** -- Property or constructor-parameter dependency injection. Pick the name that reads better; the framework treats them identically.
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
enum Scope {
  SINGLETON = 'singleton',
  TRANSIENT = 'transient',
}

type Constructor<T = any> = new (...args: any[]) => T

interface ServiceOptions {
  scope?: Scope
}
interface BeanOptions {
  scope?: Scope
}

interface RouteDefinition {
  method: string
  path: string
  handlerName: string
  validation?: { body?: any; query?: any; params?: any }
}

type MiddlewareHandler = (ctx: any, next: () => void) => void | Promise<void>

interface FileUploadConfig {
  mode: 'single' | 'array' | 'none'
  fieldName?: string
  maxCount?: number
  maxSize?: number
  /** Short extensions ('jpg'), MIME types ('image/jpeg'), wildcards ('image/*'), or a `(mimetype, filename) => boolean` predicate. */
  allowedTypes?: string[] | ((mimetype: string, filename: string) => boolean)
  customMimeMap?: Record<string, string>
}

interface TransactionManager<TTx = unknown> {
  begin(): Promise<TTx>
  commit(tx: TTx): Promise<void>
  rollback(tx: TTx): Promise<void>
}

type BuilderOf<T> = {
  [K in keyof T as T[K] extends Function ? never : K]-?: (value: T[K]) => BuilderOf<T>
} & { build(): T }

interface Buildable<T> {
  builder(): BuilderOf<T>
}
```

## AppModule

Interface every feature module must implement.

```typescript
interface AppModule {
  /** Optional — modules holding only decorated classes need no explicit bindings. */
  register?(container: Container): void
  /** `null` for non-HTTP modules. */
  routes(): ModuleRoutes | ModuleRoutes[] | null
}

type AppModuleClass = new () => AppModule

interface ModuleRoutes {
  path: string
  /** Required unless `controller` is given — the router is derived from it. */
  router?: any
  /** Used for the auto-derived router and for OpenAPI generation. */
  controller?: any
  /** `false` mounts without the `/v{n}` segment, even when the app has a default version. */
  version?: number | false
  /** `false` drops `apiPrefix` — for probes, fixed webhook URLs, `/.well-known`. Pair with `version: false` to mount at `path` exactly. */
  prefix?: false
  /** [Route flags](#route-flags) applied to every route this mount produces. Lowest precedence: method > class > mount. */
  flags?: readonly RouteFlagName[] | RouteFlagRecord
}
```

`flags` is the **module registration site** — the only way to flag routes on a
controller you do not own, since a decorator has to be written on the class:

```ts
routes: () => ({ path: '/webhooks', controller: WebhooksController, flags: ['auth.public'] })
```

## AppAdapter

Lifecycle hooks for plugging in cross-cutting concerns (database, docs, rate limiting). Build adapters with [`defineAdapter()`](#defineadapter); the call site mounts the result via `bootstrap({ adapters: [...] })`. Full narrative at [Adapters](../guide/adapters.md).

```typescript
interface AdapterContext {
  http: AdapterHttp // engine-agnostic route/mount/static/middleware surface (preferred)
  app: any // engine-native app — Express by default; escape hatch
  container: Container // DI container
  server?: any // http.Server (only available in afterStart)
  env: string // NODE_ENV (default: 'development')
  isProduction: boolean // true when NODE_ENV === 'production'
}

interface AdapterHttp {
  route(method: string, path: string, handler: (ctx: any) => unknown): void
  mount(prefix: string, routes: unknown[]): void
  serveStatic(prefix: string, dir: string): void
  use(mw: unknown, opts?: { path?: string | RegExp | (string | RegExp)[] }): void
}

interface AppAdapter {
  name?: string
  /** Other plugin/adapter names that must mount before this one. Topo-sorted at boot. */
  dependsOn?: readonly KickJsPluginName[]
  middleware?(): AdapterMiddleware[]
  beforeMount?(ctx: AdapterContext): void
  onRouteMount?(controllerClass: any, mountPath: string): void
  beforeStart?(ctx: AdapterContext): void
  afterStart?(ctx: AdapterContext): void
  shutdown?(): void | Promise<void>
  contributors?(): ContributorRegistrations
  onHealthCheck?(): Promise<{ name: string; status: 'up' | 'down'; message?: string }>
}

type MiddlewarePhase = 'beforeGlobal' | 'afterGlobal' | 'beforeRoutes' | 'afterRoutes'

interface AdapterMiddleware {
  handler: any
  phase?: MiddlewarePhase
  path?: string
}
```

### defineAdapter

```typescript
function defineAdapter<TConfig = Record<string, unknown>, TExtra = unknown>(
  options: DefineAdapterOptions<TConfig, TExtra>,
): AdapterFactory<TConfig, TExtra>

interface DefineAdapterOptions<TConfig, TExtra = unknown> {
  name: string
  version?: string
  requires?: { kickjs?: string }
  defaults?: Partial<TConfig>
  /** Returns the AppAdapter lifecycle object plus any extra public methods (TExtra). */
  build(config: TConfig, ctx: BuildContext): Omit<AppAdapter, 'name'> & TExtra
}
```

`BuildContext` is the same `{ name, scoped }` shape used by `definePlugin` — see the [Plugins reference](#plugins).

::: warning `defineAdapter()` returns a factory, not an adapter
The function returns an `AdapterFactory`, not an `AppAdapter`. `bootstrap({ adapters: [...] })` expects the **result of calling** the factory (`MyAdapter()`, `MyAdapter.scoped('x')`, or `MyAdapter.async(...)`). Passing the factory itself is a type error.
:::

### AdapterFactory

The callable returned by `defineAdapter()`. Same surface as [`PluginFactory`](#pluginfactory) so the mental model is shared.

```typescript
interface AdapterFactory<TConfig, TExtra = unknown> {
  /** Singleton form — name matches the definition. */
  (config?: Partial<TConfig>): AppAdapter & TExtra
  /** Multi-instance form — name becomes `${defName}:${scopeName}`. */
  scoped(scopeName: string, config?: Partial<TConfig>): AppAdapter & TExtra
  /** Deferred-config form — inner adapter built inside `beforeStart`. */
  async(opts: AdapterAsyncOptions<TConfig>): AppAdapter
  /** Read-only access to the original definition. */
  readonly definition: Readonly<DefineAdapterOptions<TConfig, TExtra>>
}

interface AdapterAsyncOptions<TConfig> {
  inject?: readonly unknown[]
  useFactory(...deps: any[]): TConfig | Promise<TConfig>
}
```

::: warning `.async()` skips early adapter hooks
The async form resolves the config inside `beforeStart`, so the inner adapter's `middleware()`, `contributors()`, `beforeMount()`, and `onRouteMount()` are **not picked up** — those phases have already run. Only `beforeStart`, `afterStart`, `shutdown`, and `onHealthCheck` fire on the lazily-built inner adapter.
:::

The `TExtra` generic preserves any public methods `build()` exposes beyond the `AppAdapter` contract — useful for adapters that ship helpers external callers need to invoke directly (e.g. `OtelAdapter.applyRedaction`).

## Plugins

The highest-level extension primitive — a plugin bundles modules, adapters, middleware, DI bindings, and context contributors into one reusable unit. Build them with `definePlugin()`; mount them via the `plugins?: KickPlugin[]` field on `bootstrap()`. The full narrative lives at [Plugins](../guide/plugins.md); this section is the type reference.

### definePlugin

```typescript
function definePlugin<TConfig = Record<string, unknown>>(
  options: DefinePluginOptions<TConfig>,
): PluginFactory<TConfig>

interface DefinePluginOptions<TConfig> {
  name: string
  version?: string
  requires?: { kickjs?: string }
  defaults?: Partial<TConfig>
  build(config: TConfig, ctx: BuildContext): Omit<KickPlugin, 'name'>
}

interface BuildContext {
  /** Resolved instance name — definition name for the bare call, `${name}:${scope}` for `.scoped()`. */
  name: string
  /** True when produced by `.scoped()`. */
  scoped: boolean
}
```

### PluginFactory

The callable returned by `definePlugin()`. Bare call produces a singleton; `.scoped()` and `.async()` cover the multi-instance and deferred-config cases.

```typescript
interface PluginFactory<TConfig> {
  /** Singleton form — `AuthPlugin(config)`. */
  (config?: Partial<TConfig>): KickPlugin
  /** Multi-instance form — namespaces the resolved name to `${defName}:${scopeName}`. */
  scoped(scopeName: string, config?: Partial<TConfig>): KickPlugin
  /** Deferred-config form — resolves DI tokens then calls `useFactory` inside `onReady`. */
  async(opts: PluginAsyncOptions<TConfig>): KickPlugin
  /** Read-only access to the original definition. */
  readonly definition: Readonly<DefinePluginOptions<TConfig>>
}

interface PluginAsyncOptions<TConfig> {
  inject?: readonly unknown[]
  useFactory(...deps: any[]): TConfig | Promise<TConfig>
}
```

::: warning `.async()` skips early hooks
The async form resolves the inner plugin lazily inside `onReady`, so any `modules()` / `setup()` / `adapters()` / `middleware()` / `contributors()` the plugin returns is **not registered** — those hooks have already run. Use the bare call or `.scoped()` when the plugin needs to contribute anything other than DI bindings or post-start work.
:::

### KickPlugin

The lifecycle object returned by `build()`. Every hook is optional — emit only what the plugin needs.

```typescript
interface KickPlugin {
  name: string
  /** Other plugin names that must mount before this one. Topo-sorted at boot. */
  dependsOn?: readonly KickJsPluginName[]

  register?(container: Container): void
  modules?(): AppModuleEntry[]
  setup?(registry: ModuleRegistry): void
  adapters?(): AppAdapter[]
  middleware?(): any[]
  contributors?(): ContributorRegistrations
  onReady?(container: Container): void | Promise<void>
  shutdown?(): void | Promise<void>

  /** DevTools introspection snapshot — runs on poll, keep cheap. */
  introspect?(): unknown | Promise<unknown>
  /** Plugin-owned tabs rendered inside the DevTools UI. */
  devtoolsTabs?(): readonly unknown[]
}
```

`KickJsPluginName` resolves to `string` until `kick typegen` populates `KickJsPluginRegistry`, at which point it narrows to a string-literal union of every plugin/adapter name in the project — making `dependsOn` autocomplete-safe.

### Mounting plugins

Plugins flow in through `bootstrap()`:

```typescript
interface ApplicationOptions {
  // ... other fields
  plugins?: KickPlugin[]
}
```

Plugin hooks fire in this order, before user-supplied modules/adapters/middleware:

1. `register()` — DI bindings
2. `middleware()` — global middleware
3. `modules()` + user modules — route registration
4. `setup(registry)` — imperative module mounts
5. `adapters()` + user adapters — lifecycle hooks
6. Server starts
7. `onReady()` — post-startup
8. `shutdown()` — on SIGINT/SIGTERM

Cross-plugin ordering respects `dependsOn`; cycles throw `MountCycleError` and unknown names throw `MissingMountDepError`, both at boot.

## Context Contributors (#107)

Typed, ordered, declarative way to populate `ctx.set('key', value)` before a controller handler runs. See the full guide at [Context Decorators](../guide/context-decorators.md); this section is a reference.

### defineContextDecorator

```typescript
function defineContextDecorator<
  K extends string,
  D extends Record<string, unknown> = Record<string, never>,
  Ctx extends ExecutionContext = ExecutionContext,
>(spec: ContextDecoratorSpec<K, D, Ctx>): ContextDecorator<K, D, Ctx>

interface ContextDecoratorSpec<K, D, Ctx> {
  key: K
  deps?: D // typed DI map
  dependsOn?: readonly string[] // topo-sorted at boot
  optional?: boolean // skip on resolve throw
  onError?: (err, ctx) => MaybePromise<Value | undefined> // async-permitted
  resolve: (ctx, deps) => MaybePromise<Value>
}
```

The returned function is callable as both a method/class decorator and exposes `.registration` for non-decorator registration sites (module / adapter / plugin / global hooks).

### buildPipeline / runContributors

Pure functions for programmatic use (tests, custom transports). The HTTP router calls these automatically during route mount + per request.

```typescript
function buildPipeline(
  sources: readonly SourcedRegistration[],
  options?: { route?: string },
): ContributorPipeline

function runContributors(opts: {
  pipeline: ContributorPipeline
  ctx: ExecutionContext
  container: Container
}): Promise<void>

type ContributorSource = 'method' | 'class' | 'module' | 'adapter' | 'global'
```

Precedence (high → low): `method > class > module > adapter > global`. Plugin contributors merge at `'adapter'`. Same-precedence collisions throw `DuplicateContributorError` at boot.

### Errors

All three are startup-time errors raised by `buildPipeline()` / route mount — never per request.

```typescript
class MissingContributorError extends Error {
  key
  dependent
  route?
}
class ContributorCycleError extends Error {
  cycle: readonly string[]
  route?
}
class DuplicateContributorError extends Error {
  key
  sources: readonly string[]
}
```

### ContextMeta + ExecutionContext

```typescript
// Augment to type-safely extend ctx.get/set
interface ContextMeta {}

interface ExecutionContext {
  get<K extends string>(key: K): MetaValue<K> | undefined
  set<K extends string>(key: K, value: MetaValue<K>): void
  readonly requestId: string | undefined
}

type MetaValue<K extends string, Fallback = unknown> = K extends keyof ContextMeta
  ? ContextMeta[K]
  : Fallback
```

`RequestContext` (HTTP) implements `ExecutionContext`. Future `WsContext` / `QueueContext` / `CronContext` (V2) will too.

## Route Flags

A named, inheritable fact about a route — `this endpoint is public`, `this one is
unmetered`. The core carries the fact; consumers decide what it means. Full guide
at [Route Flags](../guide/route-flags.md); this section is the reference.

The framework declares **no flag names**. Every name below is one an app chose.

### defineRouteFlag

```typescript
function defineRouteFlag<const N extends RouteFlagName>(name: N): RouteFlag<RouteFlagValue<N, true>>
function defineRouteFlag<V>(name: RouteFlagName): RouteFlag<V>
```

```ts
const Public = defineRouteFlag('auth.public') // bare: @Public
const Limit = defineRouteFlag<{ rpm: number }>('rate.limit') // valued: @Limit({ rpm: 10 })
```

Applicable to a class (every route below inherits it) or a method. `Flag.off`
removes an inherited one; `Flag.flagName` is the string. A name starting with
`!` throws — that prefix is reserved for negated tests.

### Declaration sites and precedence

| Site   | How                                            | Precedence |
| ------ | ---------------------------------------------- | ---------- |
| Method | `@Public` / `@Limit({ rpm: 10 })` on a handler | highest    |
| Class  | `@Public` on the `@Controller()`               | middle     |
| Mount  | `ModuleRoutes.flags`                           | lowest     |

Resolved at boot, so the per-request cost is a map lookup. A resolved flag is
present or absent — `@Flag.off` deletes the key rather than storing `false`, so
`false` stays usable as a real value.

### Reading flags

```typescript
interface MatchedRoute {
  readonly method: string
  readonly path: string
  readonly controller: string
  readonly handlerName: string
  readonly flags: RouteFlags
}

interface RouteFlags extends ReadonlyMap<string, unknown> {
  has(name: RouteFlagName): boolean
  get<K extends RouteFlagName>(name: K): RouteFlagValue<K> | undefined
}
```

`ctx.route` is the in-request reader — available to handlers, `@Middleware()`,
guards and contributors. It is `undefined` in **global** middleware, which runs
before a route is matched.

```typescript
function getRouteFlags(controllerClass: object, handlerName: string): RouteFlags
```

The out-of-request reader, for consumers that see a controller and a method name
rather than a live request — an adapter's `onRouteMount`, an OpenAPI generator, a
DevTools listing. It resolves all three sites, so it cannot disagree with
`ctx.route.flags`.

### Flag tests

Every consumer option that takes a flag condition (`skipWhen`, `onlyWhen`,
`exemptWhen`) accepts the same type:

```typescript
type RouteFlagTest =
  | RouteFlagName // carries this flag
  | NegatedRouteFlagName // '!name' — does NOT carry it
  | readonly RouteFlagName[] // any-of
  | readonly NegatedRouteFlagName[] // none-of
  | ((ctx: RouteFlagContext) => boolean) // anything else
```

A list is **single-polarity**: `['a', '!b']` is a compile error, because any-of
would read it as "a present or b absent" while most readers expect "and". Mixing
them at runtime throws where the consumer is constructed, not on the first
request. All-of and value checks go through a predicate.

### Consumers

| Surface                | Option                             |
| ---------------------- | ---------------------------------- |
| Context contributors   | `skipWhen` / `onlyWhen`            |
| `csrfGuard()`          | `exemptWhen`                       |
| `rateLimitGuard()`     | `exemptWhen`                       |
| `rateLimit()` (global) | `exemptWhen`, via the policy table |
| `SwaggerAdapter()`     | `publicFlag`, `securityResolver`   |
| DevTools               | `GET /_debug/routes` → `flags`     |
| Health module          | `bootstrap({ health: { flags } })` |

### Pre-match middleware: the policy table

Middleware mounted app-wide runs before routing, so it has no `ctx.route`. The
flags come to it instead: every mounted route registers its method, path and
flags in a per-application table.

```typescript
class RoutePolicyTable {
  lookup(method: string, pathname: string): RouteFlags
}

function bindRoutePolicy<T extends object>(handler: T, receive: (t: RoutePolicyTable) => void): T
```

The Application hands the table to any middleware that declared the slot, once
routes are mounted. A request matching no route matches no flags and stays
subject to the middleware — which is why an abuse control belongs here rather
than in a route-scoped guard.

### Type safety

```typescript
interface KickRouteFlags {} // augment to narrow every flag name
```

Empty by default, so flag names are plain `string` and everything compiles. Once
augmented, `defineRouteFlag`, `has`, `get`, and every consumer option narrow to
the declared names and value types. `kick typegen` writes the augmentation from
your `defineRouteFlag()` calls into `.kickjs/types/kick__route-flags.d.ts` — see
[Typegen](../guide/typegen.md).

## Logger

Named logger with component context. Console-based by default (zero deps) and pluggable via `Logger.setProvider()`.

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
- **resetProvider** -- Reverts to the default console-based provider. Intended for test teardown.

**Built-in provider:**

| Provider                          | Description                                                            |
| --------------------------------- | ---------------------------------------------------------------------- |
| `ConsoleLoggerProvider` (default) | Uses `console.*` methods. Zero deps; accepts an optional prefix string |

Bring your own backend (Pino, Winston, …) by implementing `LoggerProvider` and passing it to `Logger.setProvider()` — see the [Logging guide](../guide/logging.md).

```typescript
import { Logger, ConsoleLoggerProvider } from '@forinda/kickjs'

// Switch all loggers to console output
Logger.setProvider(new ConsoleLoggerProvider())

const log = Logger.for('MyService')
log.info('Hello') // Output: [MyService] Hello

// Restore default console backend (e.g. in afterEach)
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
  const result = await breaker.execute(() => fetch('https://payment.example.com/charge'))
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

Built-in health check endpoints are mounted at the root path, outside the API prefix.

They ship as an ordinary module — `healthModule()`, registered automatically — so they appear in the OpenAPI spec, in `logRouteTable`, and in the route registry.

::: warning They run INSIDE the middleware chain
Before v8 these were mounted straight onto the engine, ahead of every middleware. They are now mounted with your other modules, which means **global auth applies to them**. An app with app-wide authentication will require it on its probes.

That is the intended default — your app controls its own auth, and a framework route quietly bypassing it is the surprise — but it will fail a liveness check the first time it runs. Flag both probes with whatever name your app already treats as public:

```ts
bootstrap({ health: { flags: ['auth.public'] } })
```

The flags land on the mount, not on `HealthController` — the class is the framework's, the names are yours — and every consumer that reads them (an auth contributor's `skipWhen`, a guard's `exemptWhen`, `SwaggerAdapter({ publicFlag })`) covers health with no further wiring. See [Route Flags](../guide/route-flags.md#the-built-in-health-probes). You can still exempt the pathnames instead, or pass `health: false` and mount your own module.
:::

`version: false` **and** `prefix: false` on their `ModuleRoutes` is what keeps them at the root: a probe URL an orchestrator is configured against must not move when `apiPrefix` or the API version changes. The two flags are independent — `prefix: false` alone drops `/api` but keeps `/v1`, mounting at `/v1/health`.

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

interface ValidationError {
  field: string
  message: string
  code?: string
}
```
