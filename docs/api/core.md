# @forinda/kickjs — core

The framework's core API: `bootstrap()` options, decorators, modules, adapters, plugins, context contributors, route flags, logger, errors, and the smaller utilities around them. Everything on this page is imported from `@forinda/kickjs`.

The DI container and its decorators come from `@forinda/kickjs-di`, which `@forinda/kickjs` re-exports. They are summarised [below](#dependency-injection); [`@forinda/kickjs-di`](./di.md) has the full reference.

## bootstrap() options

`bootstrap(options)` is the application entry point. It takes an `ApplicationOptions` object — every field below. `modules` is the only required one; everything else has a safe default.

| Option                | Type                                                                                      | Default                         | Description                                                                                                                                                                                                                                         |
| --------------------- | ----------------------------------------------------------------------------------------- | ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `modules`             | `AppModuleEntry[]`                                                                        | **required**                    | Feature modules to load: a module class, a module instance, or a `defineModule()` factory.                                                                                                                                                          |
| `setup`               | `(registry: ModuleRegistry) => void`                                                      | —                               | Imperative/conditional module registration (`registry.mount(...)`); runs after every plugin's `setup()` and the static `modules` array.                                                                                                             |
| `adapters`            | `AppAdapter[]`                                                                            | `[]`                            | Lifecycle hooks (DB, Redis, Swagger, OTel…). Build with `defineAdapter()`.                                                                                                                                                                          |
| `plugins`             | `KickPlugin[]`                                                                            | `[]`                            | Bundles of modules + adapters + middleware + DI bindings. Build with `definePlugin()`.                                                                                                                                                              |
| `contributors`        | `ContributorRegistrations`                                                                | —                               | Global [context contributors](../guide/context-decorators.md) at `'global'` precedence.                                                                                                                                                             |
| `runtime`             | `HttpRuntime`                                                                             | `expressRuntime()`              | HTTP engine driver — `fastifyRuntime()` / `h3Runtime()` swap the engine. See [HTTP Runtimes](../guide/http-runtimes.md).                                                                                                                            |
| `middlewares`         | `MiddlewareEntry[]`                                                                       | `requestId()`, `express.json()` | Global middleware pipeline, in order. Replaces the default stack entirely when set.                                                                                                                                                                 |
| `port`                | `number`                                                                                  | `PORT` env, else `3000`         | Listen port.                                                                                                                                                                                                                                        |
| `server`              | `ServerOptions` — `{ tls?, http2?, keepAliveTimeout?, headersTimeout?, requestTimeout? }` | plain HTTP, keep-alive 65s      | The production server: TLS, HTTP/2 (Fastify and h3 only; requires `tls`), and [connection timeouts](#server-timeouts). Ignored in dev, where Vite owns the server.                                                                                  |
| `management`          | `{ port: number; host?: string; tls? }`                                                   | off                             | Serve `/health/*` — and `/metrics` / `/_debug` from adapters given `management: true` — on a second port, without the app's middleware. Ignored in dev and on serverless platforms. See [Deployment](../guide/deployment.md#a-management-port).     |
| `apiPrefix`           | `string`                                                                                  | `'/api'`                        | Global route prefix. `''` mounts at the root.                                                                                                                                                                                                       |
| `defaultVersion`      | `number \| false`                                                                         | `1`                             | Routes mount at `/{prefix}/v{version}/{path}`. `false` drops the version segment — see [Opting out of versioning](../guide/modules.md#opting-out-of-versioning).                                                                                    |
| `trustProxy`          | `boolean \| number \| string \| fn`                                                       | `false`                         | Which proxies to trust for `ctx.ip` / `X-Forwarded-*`, with Express semantics on every runtime: `true`, a hop count, an address list, or `(ip, hop) => boolean`. Prefer a hop count over `true` in production ([`KICK-SEC-W002`](#startup-checks)). |
| `jsonLimit`           | `string \| number`                                                                        | `'1mb'`                         | Largest request body parsed, on every runtime (bytes or `'1mb'`-style); larger answers 413. On Express it sizes the default parsers, so it has no effect there when you supply `middlewares`.                                                       |
| `security`            | `{ helmet?, allowedHosts? }`                                                              | `{ helmet: true }`              | Auto-inject helmet headers unless opted out. `allowedHosts` answers only the listed hosts — see [Allowed Hosts](../guide/security-headers.md#allowed-hosts).                                                                                        |
| `health`              | `boolean \| { flags?, checkTimeout? }`                                                    | `true`                          | Mount the built-in [health module](#health-endpoints). `false` leaves `/health/*` to you; `flags` puts your own route flags on both probes; `checkTimeout` (ms, default 2000) bounds each adapter check.                                            |
| `notFoundFallthrough` | `boolean`                                                                                 | `true`                          | When the app runs inside another handler (`kick dev`'s Vite server, `app.handle(req, res, next)`), Fastify and h3 hand unmatched requests back to it. `false` answers them here, as in production. Express always answers.                          |
| `contextStore`        | `'auto' \| 'manual'`                                                                      | `'auto'`                        | ALS frame for `RequestContext.set/get` + REQUEST-scoped DI. `'manual'` only if you own the frame.                                                                                                                                                   |
| `processHooks`        | `'auto' \| 'errors-only' \| 'manual'`                                                     | `'auto'`                        | Process-level error loggers + SIGINT/SIGTERM → shutdown. Use `'errors-only'` when an SDK owns shutdown.                                                                                                                                             |
| `cluster`             | `boolean \| { workers?: number }`                                                         | `false`                         | Fork workers across CPU cores (shared port). See [Cluster Mode](#cluster-mode).                                                                                                                                                                     |
| `shutdownTimeout`     | `number`                                                                                  | `30000`                         | Max ms to drain requests — and, separately, for each adapter/plugin shutdown hook (0 disables the forced exit). See [Graceful Shutdown](#graceful-shutdown).                                                                                        |
| `preStopDelay`        | `number`                                                                                  | `0`                             | Ms to keep serving after shutdown starts, with readiness already 503, before closing the server — so load balancers stop routing first.                                                                                                             |
| `logRouteTable`       | `boolean`                                                                                 | `false`                         | Log a per-controller route summary on startup (`info` level).                                                                                                                                                                                       |
| `onNotFound`          | `(req, res, next) => void`                                                                | built-in 404 / 405              | Custom unmatched-route handler. `next()` hands the request to the built-in one.                                                                                                                                                                     |
| `onError`             | `(err, req, res, next) => void`                                                           | built-in                        | Custom global error handler (built-in formats ZodError / HttpException). `next(err)` is a no-op on Fastify and h3 — send the response yourself.                                                                                                     |
| `validationError`     | `(failure) => unknown`                                                                    | 422 `HttpException`             | What a failed route validation throws — see [Custom Validation Errors](../guide/validation.md#custom-validation-errors).                                                                                                                            |
| `checks`              | `StartupCheck[]`                                                                          | —                               | Your own [startup checks](#startup-checks), run with the built-in ones before the app serves.                                                                                                                                                       |
| `silenceChecks`       | `string[]`                                                                                | —                               | Check IDs to skip, e.g. `['KICK-SEC-W002']`.                                                                                                                                                                                                        |
| `settings`            | `SettingsDeclaration[]`                                                                   | —                               | App-wide [settings sections](../guide/configuration.md#settings-sections-definesettings), validated at startup and injectable by token. Modules, adapters and plugins declare their own with `settings()`.                                          |

`onNotFound` and `onError` are connect-shaped on every engine, but the request is the raw Node request on Fastify and h3: read `req.url`, not `req.originalUrl` / `req.path` / `req.ip`.

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

> Configuration that lives in `kick.config.ts` (CLI/codegen — pattern, runtime, typegen, db) is separate. See [KickConfig](./cli.md#kickconfig).

## Dependency injection

Re-exported from [`@forinda/kickjs-di`](./di.md); the [DI guide](../guide/dependency-injection.md) covers usage.

| Group             | Exports                                                                                                                                                    |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Container         | `Container` (`getInstance`, `reset`, `register`, `registerFactory`, `registerInstance`, `resolve`, `has`, …), `tokenName`                                  |
| Class decorators  | `@Injectable`, `@Service`, `@Component`, `@Repository` (same behaviour, different names), `@Builder` / `withBuilder`                                       |
| Member decorators | `@Inject(token?)` / `@Autowired(token?)` (interchangeable; property or constructor parameter), `@Value(envKey, default?)`, `@PostConstruct`, `@PreDestroy` |
| Tokens            | `createToken<T>(name)`, `isInjectionToken`, `InjectionToken<T>`                                                                                            |
| Types             | `Scope` (`SINGLETON`, `TRANSIENT`, `REQUEST`), `Constructor`, `ServiceOptions`, `BuilderOf`, `Buildable`, `EnvKey`, `Env`                                  |

```ts
import { Service, Inject, createToken } from '@forinda/kickjs'

const GREETING = createToken<string>('app/greeting')

@Service()
class Greeter {
  constructor(@Inject(GREETING) private readonly greeting: string) {}
}
```

`METADATA` holds the metadata keys — the DI ones plus the HTTP layer's. `MaybePromise<T>` is `T | Promise<T>`.

## HTTP decorators

### @Controller

```typescript
function Controller(): ClassDecorator
```

Registers the class as an HTTP controller (a DI singleton). The route prefix comes from the module's `routes().path`, not the decorator.

### Route decorators

```typescript
function Get(path?: string, validation?: RouteDefinition['validation']): MethodDecorator
// Post, Put, Delete, Patch — same signature

interface RouteDefinition {
  method: string
  path: string // default '/'
  handlerName: string
  validation?: {
    body?: any // Zod, Valibot, Yup, any Standard Schema or KickSchema
    query?: any
    params?: any
    /** Declared response schema — never validated at runtime. Feeds Swagger and `kick typegen`. */
    response?: any
    /** OpenAPI components/schemas name for the request body. */
    name?: string
  }
}
```

### @Middleware

```typescript
function Middleware(...handlers: MiddlewareHandler[]): ClassDecorator & MethodDecorator

type MiddlewareHandler<TCtx = any> = (ctx: TCtx, next: () => void) => unknown
```

Attach middleware at class or method level. The handler's return value is ignored, so a guard may `return ctx.problem.unauthorized()`. Type it `MiddlewareHandler<RequestContext>` for a typed `ctx`.

### @FileUpload

```typescript
function FileUpload(config: FileUploadConfig): MethodDecorator

interface FileUploadConfig {
  mode: 'single' | 'array' | 'none'
  fieldName?: string // default 'file'
  maxCount?: number // array mode, default 10
  maxSize?: number // bytes, default 5MB
  /** Short extensions ('jpg'), MIME types ('image/jpeg'), wildcards ('image/*'), or a `(mimetype, filename) => boolean` predicate. */
  allowedTypes?: FileTypeFilter
  customMimeMap?: Record<string, string>
}
```

See [File Uploads](../guide/file-uploads.md).

### @ApiQueryParams

```typescript
function ApiQueryParams(config: ApiQueryParamsConfig | ColumnApiQueryParamsConfig): MethodDecorator

interface ApiQueryParamsConfig {
  filterable?: string[]
  sortable?: string[]
  searchable?: string[]
}
```

Documents a GET endpoint's `filter` / `sort` / `page` / `limit` / `q` parameters for the Swagger adapter. A column-object config (`{ columns, sortable?, searchColumns? }`, e.g. a Drizzle query config) is normalised with `normalizeApiQueryParamsConfig()`. See [Query Parsing](../guide/query-parsing.md).

### @Asset

```typescript
function Asset(assetKey: AssetKey): PropertyDecorator
```

Injects the resolved file path of an asset (`'mails/welcome'`), resolved on each property access. Any string is accepted until `kick typegen` narrows `AssetKey`. See [Asset Manager](../guide/asset-manager.md).

## AppModule

Interface every feature module implements.

```typescript
interface AppModule {
  /** Optional — modules holding only decorated classes need no explicit bindings. */
  register?(container: Container): void
  /** Context contributors at `'module'` precedence, for every route this module mounts. */
  contributors?(): ContributorRegistrations
  /** Settings sections this module needs, validated at startup. */
  settings?(): readonly SettingsDeclaration[]
  /** `null` for non-HTTP modules. */
  routes(): ModuleRoutes | ModuleRoutes[] | null
}

type AppModuleClass = new () => AppModule
type AppModuleEntry = AppModuleClass | AppModule | AppModuleFactoryEntry // what `modules` accepts

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
  flags?: RouteFlagDeclarations // readonly RouteFlagName[] | RouteFlagRecord
}
```

`flags` is the **module registration site** — the only way to flag routes on a
controller you do not own, since a decorator has to be written on the class:

```ts
routes: () => ({ path: '/webhooks', controller: WebhooksController, flags: ['auth.public'] })
```

### defineModule

```typescript
function defineModule<TConfig = Record<string, unknown>, TExtra = unknown>(
  options: DefineModuleOptions<TConfig, TExtra>,
): ModuleFactory<TConfig, TExtra>

interface DefineModuleOptions<TConfig, TExtra = unknown> {
  name: string
  version?: string
  requires?: { kickjs?: string }
  defaults?: Partial<TConfig>
  build(config: TConfig, ctx: BuildContext): AppModule & TExtra
}

interface ModuleFactory<TConfig, TExtra = unknown> {
  (config?: Partial<TConfig>): AppModule & TExtra
  scoped(scopeName: string, config?: Partial<TConfig>): AppModule & TExtra
  readonly definition: Readonly<DefineModuleOptions<TConfig, TExtra>>
}
```

Same shape as [`defineAdapter`](#defineadapter) and [`definePlugin`](#defineplugin), minus `.async()`: a module's `register()` and `routes()` run synchronously during bootstrap, so async config belongs in an adapter.

### defineModules / ModuleRegistry

```typescript
function defineModules(...initial: AppModuleEntry[]): ModuleList

class ModuleList extends Array<AppModuleEntry> {
  mount(module: AppModuleEntry): this
}

interface ModuleRegistry {
  mount(module: AppModuleEntry): void
}
```

`ModuleList` is an array, so it passes straight to `bootstrap({ modules })`. `ModuleRegistry` is what `bootstrap({ setup })` and a plugin's `setup()` receive.

```ts
const modules = defineModules().mount(HelloModule()).mount(AdminModule())
bootstrap({ modules })
```

## AppAdapter

Lifecycle hooks for plugging in cross-cutting concerns (database, docs, rate limiting). Build adapters with [`defineAdapter()`](#defineadapter); the call site mounts the result via `bootstrap({ adapters: [...] })`. Full narrative at [Adapters](../guide/adapters.md).

```typescript
interface AdapterContext {
  http: AdapterHttp // engine-agnostic route/mount/static/middleware surface (preferred)
  app: ActiveRuntime['app'] // engine-native app — Express by default; escape hatch
  fetch(request: Request): Promise<Response> // dispatch a web Request through the app
  container: Container
  server?: KickServer // http/https/http2 server (only available in afterStart)
  env: string // NODE_ENV (default: 'production')
  isProduction: boolean // true unless NODE_ENV is 'development' or 'test' (unset = production)
}

interface AdapterHttp {
  route(method: RouteMethod, path: string, handler: CtxHandler): void
  mount(prefix: string, routes: RouteEntry[]): void
  serveStatic(prefix: string, dir: string): void
  use(mw: ConnectMiddleware, opts?: UseConnectOptions): void
}

interface AppAdapter {
  name?: string
  /** Other plugin/adapter names that must mount before this one. Topo-sorted at boot. */
  dependsOn?: readonly KickJsPluginName[]
  /** Whether the adapter runs at all, decided once at startup. */
  when?: AdapterCondition
  /** Explain a startup failure this adapter recognises. */
  analyzeFailure?(err: unknown): FailureAdvice | undefined
  middleware?(): AdapterMiddleware[]
  contributors?(): ContributorRegistrations
  settings?(): readonly SettingsDeclaration[]
  beforeMount?(ctx: AdapterContext): void | Promise<void>
  onRouteMount?(controllerClass: Constructor, mountPath: string): void
  beforeStart?(ctx: AdapterContext): void | Promise<void>
  afterStart?(ctx: AdapterContext): void | Promise<void>
  onHealthCheck?(): Promise<{ name: string; status: 'up' | 'down' }>
  onError?(error: unknown, info: ErrorInfo): void | Promise<void>
  onResponse?(info: ResponseInfo): void | Promise<void>
  shutdown?(): MaybePromise
  introspect?(): IntrospectionSnapshot | Promise<IntrospectionSnapshot>
  devtoolsTabs?(): readonly unknown[]
}

type MiddlewarePhase = 'beforeGlobal' | 'afterGlobal' | 'beforeRoutes' | 'afterRoutes'
type MiddlewarePath = string | RegExp | ReadonlyArray<string | RegExp>

interface AdapterMiddleware {
  handler: RequestHandler | ErrorRequestHandler
  phase?: MiddlewarePhase
  path?: MiddlewarePath
}
```

`onError` / `onResponse` are covered under [Observers](#observers).

### Adapter conditions

```typescript
type AdapterCondition = () => boolean | string

function onEnv(name: string, value?: string): AdapterCondition // set (non-empty), or equal to `value`
function onPackage(name: string): AdapterCondition // the package resolves from the app
function allOf(...conditions: AdapterCondition[]): AdapterCondition
```

A condition returns `true` to keep the adapter, or `false` / a reason string to leave it out. An adapter that `dependsOn` one left out is left out too. The outcomes are in `app.getConditionReport()` (`ConditionOutcome[]`) and DevTools' `/_debug/conditions`. See [Turning an adapter on or off](../guide/adapters.md#turning-an-adapter-on-or-off).

```ts
const cache: AppAdapter = { name: 'Cache', when: onEnv('REDIS_URL') /* … */ }
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
  inject?: ReadonlyArray<unknown>
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
  inject?: ReadonlyArray<unknown>
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
  settings?(): readonly SettingsDeclaration[]
  onReady?(container: Container): void | Promise<void>
  onError?(error: unknown, info: ErrorInfo): void | Promise<void>
  onResponse?(info: ResponseInfo): void | Promise<void>
  shutdown?(): void | Promise<void>

  /** DevTools introspection snapshot — runs on poll, keep cheap. */
  introspect?(): IntrospectionSnapshot | Promise<IntrospectionSnapshot>
  /** Plugin-owned tabs rendered inside the DevTools UI. */
  devtoolsTabs?(): readonly unknown[]
}
```

`KickJsPluginName` resolves to `string` until `kick typegen` populates `KickJsPluginRegistry`, at which point it narrows to a string-literal union of every plugin/adapter name in the project — making `dependsOn` autocomplete-safe.

### Mounting plugins

Plugin hooks fire in this order, before user-supplied modules/adapters/middleware:

1. `register()` — DI bindings
2. `middleware()` — global middleware
3. `modules()` + user modules — route registration
4. `setup(registry)` — imperative module mounts
5. `adapters()` + user adapters — lifecycle hooks
6. Server starts
7. `onReady()` — post-startup
8. `shutdown()` — on SIGINT/SIGTERM

Cross-plugin ordering respects `dependsOn`; cycles throw `MountCycleError`, unknown names throw `MissingMountDepError`, and two mounts with one name throw `DuplicateMountNameError`, all at boot. `mountSort()` is the sorter, exported for tooling.

## Observers

Adapters and plugins can observe errors and finished responses with `onError` / `onResponse`. Observe-only: a throw in an observer is logged and skipped. Guide: [Observability](../guide/observability.md).

```typescript
interface ErrorInfo {
  source: 'request' | 'uncaught' | 'unhandled-rejection' | 'background' | 'job' | (string & {})
  requestId?: string
  method?: string
  path?: string
  route?: string
  status?: number
  context?: Record<string, unknown>
}

interface ResponseInfo {
  method: string
  path: string
  route?: string
  status: number
  durationMs: number
  requestId?: string
}

function reportError(error: unknown, info: ErrorInfo): void
function reportResponse(info: ResponseInfo): void
```

`onError` receives request errors of any status (filter on `info.status`), uncaught exceptions, unhandled rejections, failed `waitUntil` work, failed queue jobs, and anything passed to `reportError()`. Responses are only timed while something listens to `onResponse`.

## Context Contributors (#107)

Typed, ordered, declarative way to populate `ctx.set('key', value)` before a controller handler runs. See the full guide at [Context Decorators](../guide/context-decorators.md); this section is a reference.

### defineContextDecorator

```typescript
function defineContextDecorator(spec: ContextDecoratorSpec): ContextDecorator

interface ContextDecoratorSpec<K, D, P, Ctx> {
  key: K
  deps?: D // typed DI map
  dependsOn?: readonly ContextMetaKey[] // topo-sorted at boot
  optional?: boolean // skip on resolve throw
  beforeValidation?: boolean // HTTP: run before validation + @Middleware (auth → 401 before 422)
  skipWhen?: RouteFlagTest // don't run on routes matching this flag test
  onlyWhen?: RouteFlagTest // run only on routes matching it
  paramDefaults?: Partial<P> // defaults for call-site params
  requiredParams?: readonly (keyof P & string)[] // runtime check for missing params
  onError?: (err, ctx, params) => MaybePromise<Value | undefined | void>
  resolve: (ctx, deps, params) => MaybePromise<Value>
}
```

The returned function is a method/class decorator (`@LoadTenant`), can take call-site params (`@RequirePerm({ action: 'audit:read' })`), and exposes `.registration` (and `.with(params).registration`) for the non-decorator sites — module / adapter / plugin / global. Declare a params type with `defineContextDecorator.withParams<P>()({ ... })`. A params field with no entry in `paramDefaults` must be supplied at every call site.

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
  flags?: RouteFlags // honours skipWhen / onlyWhen
}): Promise<void>

type ContributorSource = 'method' | 'class' | 'module' | 'adapter' | 'global'
```

Precedence (high → low): `method > class > module > adapter > global`. Plugin contributors merge at `'adapter'`. Same-precedence collisions throw `DuplicateContributorError` at boot.

### Errors

The first three are startup-time errors raised by `buildPipeline()` / route mount — never per request. `MissingContextValueError` is thrown by `ctx.require(key)` when nothing wrote the key.

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
class MissingContextValueError extends Error {
  key
  route?
}
```

### ContextMeta + ExecutionContext

```typescript
// Augment to type-safely extend ctx.get/set
interface ContextMeta {}

interface ExecutionContext {
  get<K extends ContextMetaKey>(key: K): MetaValue<K> | undefined
  /** Like get, but throws MissingContextValueError when the key is unset. */
  require<K extends ContextMetaKey>(key: K): Exclude<MetaValue<K>, undefined>
  set<K extends ContextMetaKey>(key: K, value: MetaValue<K>): void
  readonly requestId: string | undefined
}

type MetaValue<K extends string, Fallback = unknown> = K extends keyof ContextMeta
  ? ContextMeta[K]
  : Fallback
```

`RequestContext` (HTTP) implements `ExecutionContext`.

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
  readonly method: RouteMethod
  /** Path as declared on the handler, e.g. `/:id`. */
  readonly path: string
  /** Full pattern with mount prefix and version, e.g. `/api/v1/users/:id`. */
  readonly pattern: string
  readonly controller?: Constructor
  readonly handlerName?: string
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

function matchesFlagTest(test: RouteFlagTest, flags: RouteFlags | undefined, route?): boolean
function assertFlagTest(test: RouteFlagTest, site: string): void
```

A list is **single-polarity**: `['a', '!b']` is a compile error, because any-of
would read it as "a present or b absent" while most readers expect "and". Mixing
them at runtime throws where the consumer is constructed (`assertFlagTest`), not
on the first request. All-of and value checks go through a predicate.

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
interface RoutePolicyTable {
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
  constructor(name?: string, fields?: Record<string, unknown>)
  static for(name: string): Logger
  child(name: string): Logger
  /** Carry `fields` on every line — a request id, a job name. */
  child(fields: Record<string, unknown>): Logger
  info(msg: string, ...args: any[]): void
  warn(msg: string, ...args: any[]): void
  error(err: unknown, msg: string, ...args: any[]): void
  error(msg: string, ...args: any[]): void
  error(err: unknown): void
  debug(msg: string, ...args: any[]): void
  trace(msg: string, ...args: any[]): void
  fatal(msg: string, ...args: any[]): void
}

function createLogger(name: string): Logger // same as Logger.for(name)
function describeError(err: unknown, maxDepth?: number): string // one line, with the `cause` chain
```

The default provider honours `LOG_LEVEL` (`trace` … `fatal`, `silent`; default `info`) and `LOG_FORMAT=json`, which writes one pino-compatible JSON object per line with `child()` fields and an `Error` argument as `err`. See the [Logging guide](../guide/logging.md).

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
  /** Return a child provider scoped to the given component name (plus any child() fields) */
  child(bindings: { component: string; [field: string]: unknown }): LoggerProvider
}

Logger.setProvider(provider: LoggerProvider): void
Logger.getProvider(): LoggerProvider
Logger.resetProvider(): void
```

- **setProvider** -- Replaces the active logging backend for all loggers. Clears the internal logger cache so subsequent `Logger.for()` calls use the new provider.
- **getProvider** -- Returns the currently active provider (useful for testing).
- **resetProvider** -- Reverts to the default console-based provider. Intended for test teardown.

**Built-in provider:**

| Provider                          | Description                                                                          |
| --------------------------------- | ------------------------------------------------------------------------------------ |
| `ConsoleLoggerProvider` (default) | Uses `console.*` methods. Zero deps; `new ConsoleLoggerProvider(prefix?, bindings?)` |

Bring your own backend (Pino, Winston, …) by implementing `LoggerProvider` and passing it to `Logger.setProvider()`.

```typescript
import { Logger, ConsoleLoggerProvider } from '@forinda/kickjs'

Logger.setProvider(new ConsoleLoggerProvider())

const log = Logger.for('MyService')
log.info('Hello') // Output: INFO [MyService] Hello

// Restore default console backend (e.g. in afterEach)
Logger.resetProvider()
```

## Errors

### HttpException

Typed HTTP error with static factories for common status codes. The global error handler turns it into a response with `status`, and merges `headers` into it.

```typescript
class HttpException extends Error {
  readonly status: number
  readonly details?: unknown // serialised into the body's `errors` field
  readonly headers?: Record<string, string>

  constructor(status: number, message: string, details?: unknown, headers?: Record<string, string>)

  withHeaders(headers: Record<string, string>): HttpException

  static fromZodError(error: any, message?: string): HttpException
  static badRequest(message?: string): HttpException
  static unauthorized(message?: string, wwwAuthenticate?: string): HttpException
  static forbidden(message?: string): HttpException
  static notFound(message?: string): HttpException
  static methodNotAllowed(allowedMethods: string[], message?: string): HttpException // sets Allow
  static conflict(message?: string): HttpException
  static unprocessable(message?: string, details?: ValidationError[]): HttpException
  static tooManyRequests(message?: string, retryAfterSeconds?: number): HttpException // sets Retry-After
  static serviceUnavailable(message?: string, retryAfterSeconds?: number): HttpException
  static internal(message?: string): HttpException
}

interface ValidationError {
  field: string
  message: string
  code?: string
}
```

`HttpStatus` is a constant map of status codes (`HttpStatus.NOT_FOUND === 404`); `HttpStatusCode` is the union of its values.

### ProblemException / Problems

RFC 9457 Problem Details. Throw a `ProblemException` and the error handler answers `application/problem+json`. Guide: [RFC 9457 — Problem Details](../guide/error-handling.md#rfc-9457-—-problem-details).

```typescript
interface ProblemDetails {
  type?: string // default 'about:blank'
  title?: string // default: the status's reason phrase
  status: number
  detail?: string
  instance?: string
  [key: string]: unknown // extension members
}

class ProblemException extends HttpException {
  readonly problem: ProblemDetails
  constructor(problem: ProblemDetails, headers?: Record<string, string>)
}

const Problems: {
  badRequest(input?: Omit<ProblemDetails, 'status'>): ProblemException
  // unauthorized(input?, wwwAuthenticate?), forbidden, notFound,
  // methodNotAllowed(allowedMethods, input?), conflict, unprocessable,
  // tooManyRequests(input?, retryAfterSeconds?), serviceUnavailable(input?, retryAfterSeconds?),
  // internal, fromZodError(error, input?)
}

function normalizeProblem(input: ProblemDetails): ProblemDetails // fills type and title
function defaultProblemTitle(status: number): string
```

```ts
throw Problems.notFound({ detail: `No order ${id}` })
```

### KickError

Structured framework error with a code, a cause and a fix hint. The message is the formatted block, so a thrown `KickError` reads well in a terminal. See [Framework errors with fix hints](../guide/error-handling.md#framework-errors-with-fix-hints).

```typescript
interface KickErrorInit {
  code: string
  summary: string
  cause?: string
  fix?: string
  docsUrl?: string
  context?: Record<string, unknown>
}

class KickError extends Error {
  constructor(init: KickErrorInit) // code, summary, cause, fix, docsUrl, context as readonly fields
}

function formatKickError(err: KickErrorInit | KickError, options?: { color?: boolean }): string
```

## Cache

Method-level caching through a pluggable provider. Guide: [Caching](../guide/caching.md).

```typescript
function Cacheable(ttl?: number, options?: { key?: string }): MethodDecorator // ttl in seconds, default 60
function CacheEvict(key: string): MethodDecorator // evicts by key prefix after the method runs

interface CacheProvider {
  get(key: string): Promise<any | null>
  set(key: string, value: any, ttlMs: number): Promise<void>
  del(key: string): Promise<void>
  delByPrefix?(prefix: string): Promise<void> // needed by @CacheEvict
  shutdown?(): Promise<void>
}

class MemoryCacheProvider implements CacheProvider {
  constructor(maxEntries?: number) // default 10_000, LRU
}

function setCacheProvider(provider: CacheProvider): void
function getCacheProvider(): CacheProvider
```

Simultaneous misses on one key share a single call of the method.

## Cron

Declare scheduled methods with `@Cron`; `KickCronAdapter` runs them on a Node server (it needs the `croner` package). Guide: [Scheduled Tasks](../guide/cron.md).

```typescript
function Cron(expression: string, options?: CronOptions): MethodDecorator

interface CronOptions<Meta = Record<string, unknown>> {
  name?: string // default `ClassName.method`
  description?: string
  timezone?: string // IANA, e.g. 'Africa/Nairobi'
  runOnInit?: boolean // Node server: run once at startup
  overlap?: boolean // default false: a busy job skips the tick
  enabled?: boolean | (() => boolean) // checked on every tick
  meta?: Meta // read from the run context as `run.meta`
}

const KickCronAdapter: AdapterFactory<{ enabled?: boolean }> // enabled defaults to true
```

For custom runners and platform crons: `listCronJobs(container)`, `runCronJob(job, container, trigger)`, `runCronJobs(container, filter, trigger)`, `getCronJobs(target)`, `cronScheduleId(expression)` and `isCronJobEnabled(job)`. Under `bootstrap({ cluster })` only the worker the primary marks with `KICK_CRON_WORKER=1` (`CRON_WORKER_ENV`) schedules, so a job runs once per cluster; separate replicas each schedule every job — turn the adapter off on all but one (`KickCronAdapter({ enabled: false })`).

## Background jobs

Declare job handlers with decorators; a queue adapter (e.g. `@forinda/kickjs-queue`) runs them. Guide: [Background Jobs](../guide/jobs.md).

```typescript
function Job(queue: string): ClassDecorator // also registers the class as a @Service
function Process(jobName?: string): MethodDecorator // omit the name to handle every job on the queue

interface JobDispatcher {
  dispatch<Data = unknown>(
    queue: string,
    name: string,
    data: Data,
    options?: Record<string, unknown>,
  ): Promise<unknown>
}

const JOB_DISPATCHER: InjectionToken<JobDispatcher>
```

```ts
@Service()
class Signup {
  @Inject(JOB_DISPATCHER) private jobs!: JobDispatcher
  async run(user: User) {
    await this.jobs.dispatch('email', 'welcome', { userId: user.id })
  }
}
```

For adapter authors: `listJobHandlers(container)`, `listJobQueues(container)`, `runJob(...)`, `NoJobHandlerError`, and `registerJobContext` / `stampJobContext` for carrying request context into a job.

## Disposables

```typescript
type Disposable = () => void | Promise<void>

function registerDisposable(fn: Disposable): () => void // returns an unregister function
function disposeAll(): Promise<void> // run and clear all; errors are swallowed per entry
```

Teardown for in-process resources a store or middleware factory owns (an interval, a Map). `Application.shutdown()` drains them; so do HMR rebuilds and test teardown.

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

## Passwords and signed tokens

Node only. Guide: [Passwords and Signed Tokens](../guide/passwords-and-tokens.md).

```ts
hashPassword(password: string, options?: PasswordHashOptions): Promise<string>
verifyPassword(
  password: string,
  stored: string | null | undefined, // pass undefined for a missing user — same timing
  options?: VerifyPasswordOptions,
): Promise<PasswordCheck> // { ok: boolean; needsRehash: boolean }

interface PasswordHashOptions { N?: number; r?: number; p?: number } // scrypt; default 2^14, 8, 5
interface VerifyPasswordOptions extends PasswordHashOptions {
  legacy?: readonly LegacyHasher[] // bcrypt/argon2 rows imported from elsewhere
}
interface LegacyHasher {
  matches(stored: string): boolean
  verify(password: string, stored: string): boolean | Promise<boolean>
  dummy: string // a hash at the cost your rows use, checked when the account isn't in this format
}

createSigner(options: { secret: string | string[]; salt: string }): Signer

interface Signer {
  sign(value: unknown): string
  verify<T = unknown>(token: string, options?: { maxAge?: number }): // maxAge in ms; never throws
    | { ok: true; value: T; issuedAt: Date }
    | { ok: false; reason: 'invalid' | 'expired' }
}
```

A legacy hash that verifies returns `needsRehash: true`, so the account moves to scrypt at its next login. A `secret` list rotates keys: the first signs, every one verifies.

```ts
matchesBearer(header: unknown, secret: string): boolean // constant-time `Bearer <secret>` check; also in @forinda/kickjs/web
```

## Cluster Mode

Run multiple worker processes sharing the same port for multi-core utilization. The primary process forks workers and forwards SIGTERM/SIGINT signals. Dead workers are automatically restarted after a short delay.

```typescript
interface ClusterOptions {
  workers?: number // default os.cpus().length
  gracefulShutdownTimeout?: number // ms before a worker is killed on shutdown, default 5000
  restartDelay?: number // ms between restarts, default 1000
  maxFailures?: number // failures within restartWindow before restarts stop, default 5
  restartWindow?: number // ms, default 30000
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
4. Dead workers are restarted after `restartDelay` (1 second); after `maxFailures` crashes within `restartWindow`, the primary stops restarting them.

`bootstrap()`'s `cluster` option is typed `{ workers?: number }`; the object is passed through to the primary as `ClusterOptions`. Cluster mode is ignored under `kick dev`.

Use `isClusterPrimary()` to check if the current process is the primary (e.g. for one-time initialization tasks like database migrations).

## Health Endpoints

Built-in health check endpoints are mounted at the root path, outside the API prefix.

They ship as an ordinary module — `healthModule()`, registered automatically — so they appear in the OpenAPI spec, in `logRouteTable`, and in the route registry. `HealthController`, `HEALTH_PROBE` and the `HealthModuleConfig` / `HealthCheckResult` types are exported for apps that mount their own.

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

Liveness probe. Returns `200` with `{ status: 'ok', uptime }` while the process runs, and `200` with `{ status: 'draining', uptime }` during shutdown. It never fails while draining: an orchestrator restarts a container whose liveness probe fails, which would cut the graceful shutdown short. Readiness is what turns traffic away.

### GET /health/ready

Readiness probe. Runs `onHealthCheck()` on every adapter that implements it and aggregates the results. Returns `200` with `{ status: 'ready', checks }` when all adapters report healthy. Returns `503` with `{ status: 'degraded', checks }` when any adapter is down. Returns `503` with `{ status: 'draining', checks: [] }` during shutdown, and `503` with `{ status: 'starting', checks: [] }` while `start()` is still running — which a [management port](../guide/deployment.md#a-management-port) can answer before the app serves.

- Each check gets `health.checkTimeout` milliseconds (default `2000`). One that doesn't answer in time counts as `{ status: 'down', reason: 'timeout' }`, and one that throws as `reason: 'error'`, so a hung dependency can't hang the probe.
- Probes within one second share a single run, so several probes arriving together don't each hit the database.
- A check that takes more than half its timeout is logged as slow.

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

## Metrics

```typescript
function metricsAdapter(options?: MetricsOptions): AppAdapter

interface MetricsOptions {
  path?: string // default '/metrics'
  token?: string // require `Authorization: Bearer <token>`
  buckets?: number[] // histogram buckets in seconds; default 5ms to 10s
}
```

Serves Prometheus text: a request-duration histogram per route pattern, plus memory, heap and event-loop lag. The endpoint is mounted ahead of your middleware, so your auth does not cover it — set `token` unless only the scraper can reach the port. See [Metrics](../guide/deployment.md#metrics).

## Background work

```typescript
function waitUntil(promise: Promise<unknown>): void
function settleBackgroundWork(): Promise<void>
```

`waitUntil` keeps work running after the response is sent — on serverless platforms the function stays alive until it settles; a rejection is reported to `onError` with `source: 'background'`. `settleBackgroundWork()` waits for everything still pending. See [Work that outlives the response](../guide/serverless.md#work-that-outlives-the-response-waituntil).

## Route URLs

Build a route's URL from its name, `'<Controller>.<method>'`. All three take `(name, params?, query?)` and return the full path — API prefix and version included — with `:params` encoded and the query appended (arrays as repeated keys). An unknown name or a missing param throws; after `kick typegen`, both are compile errors.

| Where                       | Use                                                         |
| --------------------------- | ----------------------------------------------------------- |
| In a handler                | `ctx.urlFor('UsersController.show', { id })`                |
| In a service, job or mailer | `@Inject(ROUTE_URLS) urls: UrlBuilder` → `urls.urlFor(...)` |
| With the app in hand        | `app.urlFor(...)` — `app` is what `bootstrap()` returns     |

```typescript
interface UrlBuilder {
  urlFor<N extends RouteName>(name: N, ...args: UrlForArgs<N>): string
}

const ROUTE_URLS: InjectionToken<UrlBuilder>
type RouteName // the KickRoutes.Named keys after typegen; string before
```

Each app (and `createWebApp`) binds `ROUTE_URLS` before modules register, so services can inject it; it is filled as routes mount. Like every DI binding it is one per process — with two apps in one process it is the one set up last — while `ctx.urlFor()` always uses the app serving the request. A controller mounted under two paths keeps its first. See [Linking to routes](../guide/controllers.md#linking-to-routes).

## Startup Timeline

`app.getStartupTimeline()` returns where the last startup's time went: `{ totalMs, steps }`, with one step per phase (`middleware`, `modules`, `routes`, `error handlers`, `checks`, `listen`, `ready`) and one per adapter hook (`'<Adapter>.beforeMount'`, `'.beforeStart'`, `'.afterStart'`). A hook's time is its own and is not counted in the phase around it. Each `setup()` (including an HMR rebuild) starts a new timeline.

When startup takes longer than a second, the app logs its three slowest steps at `info`. DevTools serves the timeline at [`/_debug/startup`](../guide/devtools.md).

## Startup Checks

Once the app is assembled and before it serves a request, `start()` runs a set of checks against it: the framework's and your own. A check reports messages with a stable ID. A `warning` is logged; an `error` fails startup with a `StartupCheckError` listing every error and its fix. A check that throws is logged and skipped.

Built-in checks run in production only (`deploy: true`):

| ID              | When                                                                                                                          |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `KICK-SEC-W001` | No `security.allowedHosts` — any `Host` is accepted. See [Allowed Hosts](../guide/security-headers.md#allowed-hosts).         |
| `KICK-SEC-W002` | `trustProxy: true` — every `X-Forwarded-For` hop is trusted, so a direct client can choose its IP. Trust a hop count instead. |

Add your own with `defineCheck`, and skip any ID you have decided to accept with `silenceChecks`:

```ts
import { bootstrap, defineCheck } from '@forinda/kickjs'

const noLocalDb = defineCheck({
  name: 'database url',
  deploy: true, // production only
  run: () =>
    process.env.DATABASE_URL?.includes('localhost')
      ? {
          id: 'APP-E001',
          level: 'error',
          message: 'DATABASE_URL points at localhost',
          fix: 'Set DATABASE_URL to the production database',
        }
      : undefined,
})

bootstrap({
  modules,
  checks: [noLocalDb],
  silenceChecks: ['KICK-SEC-W002'], // behind a proxy that strips X-Forwarded-For
})
```

A check's `run(ctx)` receives `{ options, routes, production }` — the app's options, every mounted route as `{ method, path }`, and whether the app runs as production (`NODE_ENV` unset or anything but `development` / `test`) — and returns a message, a list, or nothing. Checks run in `start()` and in serverless handlers, not in `createTestApp()`.

## Graceful Shutdown

The `Application` tracks in-flight requests and provides a graceful shutdown sequence that drains active connections before tearing down adapters.

```typescript
class Application {
  /** Whether the application is currently draining in-flight requests */
  get isDraining(): boolean
  /** Number of HTTP requests currently being processed */
  get inFlightRequests(): number
  /** Initiate graceful shutdown. `closeServer: false` keeps the server (HMR rebuilds). */
  shutdown(options?: { closeServer?: boolean }): Promise<void>
}
```

### Shutdown sequence

1. **Wait for the load balancers** -- with `preStopDelay` set, the server keeps serving for that many milliseconds while `/health/ready` already answers `503`, so balancers stop routing here before connections are refused. Default `0`; not counted against `shutdownTimeout`.
2. **Stop accepting connections** -- `server.close()` prevents new TCP connections.
3. **Drain in-flight requests** -- Waits for all active requests to complete their response (tracked via `finish`/`close` events).
4. **Run adapter and plugin shutdowns** -- Calls `shutdown()` on all registered adapters and plugins concurrently via `Promise.allSettled`, each given up to `shutdownTimeout` of its own. A full shutdown can therefore take `preStopDelay` plus twice `shutdownTimeout`; keep your platform's grace period above that.
5. **Force exit on timeout** -- If requests do not drain within `shutdownTimeout` (default 30 seconds), the shutdown proceeds anyway. Set to `0` to disable the forced timeout.

Safe to call multiple times -- subsequent calls are no-ops.

```typescript
import { bootstrap } from '@forinda/kickjs'

const app = await bootstrap({
  modules,
  shutdownTimeout: 15_000, // 15 seconds (default: 30_000)
  preStopDelay: 5_000, // keep serving 5s after readiness flips (default: 0)
})

// Trigger shutdown on SIGTERM (already wired by bootstrap, shown for clarity)
process.on('SIGTERM', () => app.shutdown())
```

During draining, `/health/ready` returns `503` so load balancers stop routing traffic to the instance; `/health/live` keeps returning `200`.

### Server timeouts

`bootstrap({ server })` sets the production server's connection timeouts:

| Option             | Default                   |                                                                                                                                                                                                                                   |
| ------------------ | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `keepAliveTimeout` | `65000`                   | How long an idle keep-alive connection stays open. Keep it above your load balancer's idle timeout (AWS ALB: 60s), or the balancer reuses connections the server is closing and requests fail with 502. Node's own default is 5s. |
| `headersTimeout`   | `keepAliveTimeout + 1000` | How long receiving the request headers may take.                                                                                                                                                                                  |
| `requestTimeout`   | `300000`                  | How long receiving the whole request may take; `0` disables it.                                                                                                                                                                   |

They apply to HTTP/1.1 servers (plain and TLS); in dev, Vite owns the server.

## Other utilities

| Export                                                                                                      | Purpose                                                                                                 |
| ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `ref`, `computed`, `watch`, `reactive`, `isRef`, `unref`, `toRefs`                                          | Small reactivity primitives. See [Reactivity](../guide/reactivity.md).                                  |
| `assets`, `useAssets()`, `resolveAsset(namespace, key)`, `clearAssetCache()`, `ASSETS`, `UnknownAssetError` | Typed asset lookup — the runtime side of `@Asset`. See [Asset Manager](../guide/asset-manager.md).      |
| `normalizePath(path?)`, `joinPaths(...segments)`, `buildMountPath(apiPrefix, version, path?)`               | Path helpers the router uses: `buildMountPath('/api', 1, 'users')` → `/api/v1/users`.                   |
| `setClassMeta` / `getClassMeta` / `setMethodMeta` / `getMethodMeta` / `pushClassMeta` / … / `getMetaRecord` | Typed wrappers over `reflect-metadata`, for writing [custom decorators](../guide/custom-decorators.md). |
| `IntrospectionSnapshot`, `IntrospectFn`                                                                     | The shape `introspect()` returns to DevTools.                                                           |
