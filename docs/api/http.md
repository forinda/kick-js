# @forinda/kickjs — HTTP

Runtime-agnostic HTTP layer with a declarative middleware pipeline, request context, routing, and query string parsing. The engine is pluggable — Express (default), Fastify or h3 — selected with `bootstrap({ runtime })`.

Exported from `@forinda/kickjs`; there is no separate `@forinda/kickjs-http` package. See the [package overview](./kickjs.md) for the subpath entry points.

## Application

Wires the chosen engine, the DI container, modules, adapters and middleware.

```typescript
class Application {
  constructor(options: ApplicationOptions)

  setup(): Promise<void>
  start(): Promise<void>
  /** setup() without a listening server — the serverless path behind createHandler(). */
  startWithoutServer(): Promise<void>
  /** Register modules and DI without starting the server (used by kick tinker). */
  registerOnly(): Promise<void>
  rebuild(): Promise<void>
  shutdown(options?: { closeServer?: boolean }): Promise<void>

  /** The Node request listener, following whichever runtime is configured. */
  handle(req: IncomingMessage, res: ServerResponse, next?: (err?: any) => void): void
  /** Run a web Request through the app and get its Response — no listening server needed. */
  fetch(request: Request): Promise<Response>
  /** The URL of a named route ('Controller.method'), params filled. */
  urlFor(name: RouteName, params?, query?): string

  readonly isDraining: boolean
  readonly inFlightRequests: number

  getContainer(): Container
  getRuntimeApp(): ActiveRuntime['app']
  getActiveRuntime(): { name: string; capabilities: RuntimeCapabilities }
  /** @deprecated Use getRuntimeApp(). */
  getExpressApp(): Express
  getHttpServer(): KickServer | null
  getAdapters(): AppAdapter[]
  getPlugins(): readonly KickPlugin[]
  getRoutes(): readonly MountedRouteInfo[]
  getContributors(): ReadonlyArray<{ key; source; label; dependsOn }>
  getConditionReport(): readonly ConditionOutcome[]
  getStartupTimeline(): StartupTimelineSnapshot
  /** Every env var and settings section the app reads — what `kick env example` writes. */
  describeConfig(): ConfigDescription
  /** Where each variable got its value (env, `_FILE` secret, default, provide()). Names only. */
  configOrigins(): ConfigOrigins
}
```

`setup`, `start`, `rebuild` and `shutdown` are all **async**. `shutdown({ closeServer: false })` tears down adapters and plugins but keeps the server — what an HMR rebuild uses.

Use `handle` or `fetch` to drive the app in tests or to mount it inside another server — both are engine-neutral. On h3, `fetch` calls the engine directly; on Express and Fastify it forwards through a loopback server bound to `127.0.0.1`, started on first use and closed by `shutdown()`.

`ApplicationOptions` is documented once, in the [core reference](./core.md#bootstrap-options) — it is the same object `bootstrap()` takes.

```typescript
type MiddlewareEntry = RequestHandler | { path: string; handler: RequestHandler }
```

::: warning `middleware` was removed in v8
The option is `middlewares`. The singular alias is deleted, so passing it is a type error rather than a silently ignored object. See the [v8 migration guide](../guide/migration-v7-to-v8.md#breaking-middleware-is-now-middlewares).
:::

Plugins (`KickPlugin[]`) are the highest-level extension primitive — they can bundle modules, adapters, middleware, DI bindings, and context contributors into one reusable unit. Build them with `definePlugin()` and pass the factory output here. See the [Plugins guide](../guide/plugins.md) and the [`definePlugin` API reference](./core.md#plugins).

## bootstrap

Zero-boilerplate entry point. Handles Vite HMR, graceful shutdown, and global error handlers.

```typescript
async function bootstrap(options: ApplicationOptions): Promise<Application>
```

It resolves to the started `Application`, so `const app = await bootstrap({ ... })` is the normal call.

## createHandler

The app as a request handler with no listening server of its own — Netlify Functions, Vercel Functions, any serverless or embedding host.

```typescript
function createHandler(options: ApplicationOptions | (() => Promise<unknown>)): KickHandler

interface KickHandler {
  fetch(request: Request, platform?: PlatformContext): Promise<Response>
  node(req: IncomingMessage, res: ServerResponse, platform?: PlatformContext): Promise<void>
  ready(): Promise<Application> // warm up now instead of on the first request
  close(): Promise<void>
}
```

```typescript
export const handler = createHandler({ modules })
// netlify/functions/api.mjs
export default (request, context) => handler.fetch(request, context)
```

Passing a loader (`createHandler(() => import('./index'))`) reuses the options of the `bootstrap()` call that entry makes, without starting a server. One handler per process — the DI container is process-wide. See the [serverless guide](../guide/serverless.md).

## Runtimes

```typescript
import { expressRuntime } from '@forinda/kickjs' // default — no need to pass it
import { fastifyRuntime } from '@forinda/kickjs/fastify'
import { h3Runtime } from '@forinda/kickjs/h3'

bootstrap({ modules, runtime: fastifyRuntime() })
bootstrap({ modules, runtime: h3Runtime() })
```

| Factory                     | Subpath                   | Peers                                    |
| --------------------------- | ------------------------- | ---------------------------------------- |
| `expressRuntime()`          | `@forinda/kickjs`         | `express`                                |
| `fastifyRuntime()`          | `@forinda/kickjs/fastify` | `fastify`, `@fastify/middie`             |
| `h3Runtime(options?)`       | `@forinda/kickjs/h3`      | `h3` v2 (v1 fails fast at boot)          |
| `h3WebRuntime` (deprecated) | `@forinda/kickjs/h3-web`  | alias of `h3Runtime`, kept for one major |

`h3Runtime({ h3 })` accepts a pre-imported h3 module, for when the app's `h3` is a different copy from the one this package resolves (a linked checkout). The engine-native types for typegen are `ExpressRuntimeTypes`, `FastifyRuntimeTypes` and `H3RuntimeTypes`. The runtime contract (`HttpRuntime`, `RuntimeResponse`, `RouteEntry`, `RuntimeCapabilities`, …) is exported as types from `@forinda/kickjs`. See the [HTTP runtimes guide](../guide/http-runtimes.md).

## Web fetch entry

`@forinda/kickjs/web` builds the app as a web-standard `fetch` handler for Cloudflare Workers, Bun and Deno — no Node HTTP server, no `Application`/`bootstrap`. Routes are served through h3 v2's router; module registration, DI and the contributor pipeline behave as under `bootstrap()`.

```typescript
function createWebApp(options: CreateWebAppOptions): WebApp

interface CreateWebAppOptions {
  h3: unknown // `import * as h3 from 'h3'` — must be v2
  modules: AppModuleEntry[]
  apiPrefix?: string // default '/api'
  defaultVersion?: number | false // default 1
  contributors?: ContributorRegistrations
  env?: Record<string, string | undefined> // ConfigService / @Value source (Workers bindings)
  middlewares?: MiddlewareHandler[] // ctx-style (ctx, next) only — no connect middleware
  jsonLimit?: string | number // default '1mb'; larger bodies answer 413
  settings?: SettingsDeclaration[]
  validationError?: ValidationErrorFactory
}

interface WebApp {
  fetch(request: Request, platform?: PlatformContext): Promise<Response>
  h3: unknown // the underlying h3 app
}

/** Workers: build lazily on the first call so `env` seeds config. */
function createFetchHandler(build: (env) => CreateWebAppOptions): {
  fetch(request, env?, ctx?): Promise<Response>
  scheduled(event: { cron: string }, env?, ctx?): Promise<void> // runs matching @Cron jobs
  queue(batch: QueueBatch, env?, ctx?): Promise<void> // Cloudflare Queues → @Job classes
}
```

```typescript
import { createFetchHandler } from '@forinda/kickjs/web'
import * as h3 from 'h3'
import { modules } from './modules'

export default createFetchHandler((env) => ({ h3, modules, env }))
```

Module routes must name a `controller` — Express-style `router` mounts are rejected. The entry also re-exports the edge-safe helpers: `reply`, `isReply`, `waitUntil`, `runCronJobs`, `runJob`, `KvRateLimitStore`, `KvSessionStore`, `rateLimitGuard`, `compileWebRoute`, `WebRequestShim`, `WebResponseDriver`. See the [edge deployment guide](../guide/edge-deployment.md).

## RequestContext

Unified request/response abstraction passed to every controller method. The response helpers write through an engine-neutral driver, so they behave the same on Express, Fastify, h3 and the web entry.

```typescript
class RequestContext<TBody = any, TParams = any, TQuery = any, TKeys = ContextMetaKey> {
  readonly req: ActiveRuntime['request'] // engine-native request
  readonly res: ActiveRuntime['response'] // engine-native response
  readonly next: NextFunction

  // Request data
  get body(): TBody
  get params(): TParams
  get query(): TQuery
  get headers(): IncomingHttpHeaders
  get requestId(): string | undefined
  get ip(): string | undefined // runtime's vetted client IP (honours trustProxy)
  get signal(): AbortSignal // aborts when the client disconnects
  get route(): MatchedRoute | undefined // method, path, controller, handler, flags
  get session(): Session // requires the session() middleware
  get user(): ContextMeta['user'] | undefined
  get tenantId(): string | undefined
  get roles(): string[]
  get file(): Express.Multer.File | undefined
  get files(): Express.Multer.File[] | undefined

  qs(fieldConfig?: QueryFieldConfig, options?: ParseQueryOptions): TypedParsedQuery
  get<K extends ContextMetaKey>(key: K): MetaValue<K> | undefined
  require<K extends TKeys>(key: K): Exclude<MetaValue<K>, undefined> // throws MissingContextValueError
  set<K extends ContextMetaKey>(key: K, value: MetaValue<K>): void
  urlFor(name: RouteName, params?, query?): string

  // Responses
  setHeader(name: string, value: string | number | readonly string[]): this
  json(data: any, status?: number) // default 200
  created(data: any) // 201
  noContent() // 204
  html(content: string, status?: number)
  send(body: string | Uint8Array, options?: { type?: string; status?: number }) // default text/plain
  download(buffer: Buffer, filename: string, contentType?: string)
  redirect(url: string, status?: number) // default 302 — never pass unvalidated user input
  render(template: string, data?: Record<string, any>) // requires ViewAdapter
  sendResponse(response: Response): Promise<void> // stream a web Response on any runtime
  conditional(validators: { etag?: string; lastModified?: Date }): boolean // 304 / 412 handling
  get problem(): ProblemSender // RFC 9457 problem details
  /** @deprecated Prefer ctx.problem.notFound() */
  notFound(message?: string)
  /** @deprecated Prefer ctx.problem.badRequest() */
  badRequest(message: string)

  paginate<T>(
    fetcher: (parsed: TypedParsedQuery) => Promise<{ data: T[]; total: number }>,
    fieldConfig?: QueryFieldConfig,
  ): Promise<PaginatedResponse<T>>

  waitUntil(promise: Promise<unknown>): void // keep work running after the response
  sse<T = unknown>(): SseHandler<T>
}

interface SseHandler<T = unknown> {
  send(data: T, event?: string, id?: string): void
  comment(text: string): void
  onClose(fn: () => void): void
  close(): void
}
```

`ctx.problem(details)` sends `application/problem+json`; the shorthands `badRequest`, `unauthorized`, `forbidden`, `notFound`, `conflict`, `unprocessable`, `tooManyRequests`, `internal` and `validation(issues)` pre-fill the status:

```typescript
ctx.problem.notFound({ detail: `User ${ctx.params.id} not found` })
```

`ctx.set()` throws outside the request's AsyncLocalStorage frame — the Application mounts `requestScopeMiddleware()` for you. `Ctx<Route>` is the short alias typed by a typegen route shape.

## Returning a response

```typescript
function reply<S extends number, T>(status: S, body: T): Reply<S, T>
reply.ok(body) // 200
reply.created(body) // 201
reply.accepted(body) // 202
reply.noContent() // 204

function isReply(value: unknown): value is Reply
function applyHandlerResult(ctx: RequestContext, result: unknown): boolean | Promise<boolean>
```

`return reply(201, body)` from a handler carries the status without touching the engine-native response; a plain `return value` sends it as 200 JSON. Prefer either to `ctx.res.status(...)` — `ctx.res` is a `FastifyReply` under Fastify, which has no `.json()`. An object implementing `[RESPOND](ctx)` (see `isRespondable`) writes its own response. `InferHandlerResponse<H>` is the type `kick typegen` infers from a handler's return.

## Router Builder

```typescript
function buildRouteTable(controllerClass: any, options?: BuildRoutesOptions): RouteEntry[]
function buildRoutes(controllerClass: any, options?: BuildRoutesOptions): Router // Express
function materializeRouter(entries: RouteEntry[]): Router // Express

interface BuildRoutesOptions {
  /** Contributors merged into each route's pipeline — pass when calling outside Application (tests). */
  externalSources?: readonly SourcedRegistration[]
  /** Flags the mounting module declares for every route (lowest precedence). */
  mountFlags?: RouteFlagDeclarations
}
```

- **buildRouteTable** — Turns a decorated controller into the engine-neutral route table a runtime materializes. Contributor cycles fail here, at boot.
- **buildRoutes** — `materializeRouter(buildRouteTable(...))`: an Express `Router`.

The mount prefix comes from the module's `routes().path`, not from `@Controller()`.

## Context decorators

```typescript
function defineHttpContextDecorator(spec): ContextDecorator
defineHttpContextDecorator.withParams<P>()(spec)
```

`defineContextDecorator` with the context already typed as `RequestContext`, so resolvers read `ctx.req`, `ctx.headers` and `ctx.params` without spelling the generics. See the [context decorators guide](../guide/context-decorators.md).

## Middleware

All of the below are exported from `@forinda/kickjs` and mounted through `bootstrap({ middlewares: [...] })`, in the order you declare.

| Middleware                         | Purpose                                                                  |
| ---------------------------------- | ------------------------------------------------------------------------ |
| `requestId()`                      | Generate / propagate `x-request-id`                                      |
| `requestLogger(options?)`          | Request logging — types: `LoggedRequest`, `LoggedResponse`               |
| `helmet(options?)`                 | Security headers. Auto-injected with defaults; declare it to change them |
| `cors(options?)`                   | CORS with spec-correct preflight                                         |
| `allowedHosts(hosts \| options)`   | Reject requests for a `Host` the app doesn't serve                       |
| `breachPadding(options?)`          | Random gzip-header padding against BREACH                                |
| `csrf(options?)` / `csrfGuard()`   | Double-submit cookie CSRF (global / route-scoped)                        |
| `session(options)`                 | Cookie sessions                                                          |
| `rateLimit()` / `rateLimitGuard()` | Rate limiting, pluggable store (`KvRateLimitStore`)                      |
| `validate(schema, options?)`       | Body / query / params schema validation                                  |
| `upload.single/array/none()`       | Multipart file handling (multer)                                         |
| `traceContext(options?)`           | W3C `traceparent` propagation                                            |

::: tip Declaring `helmet()` turns off the automatic one
The framework auto-injects `helmet()` unless `security.helmet` is `false`. Declaring your own stands that down — which is what makes its options work. Before v8 both ran, and the second could only add a header, never drop one, so `helmet({ frameguard: false })` still emitted `DENY`.
:::

### requestId

Generates or propagates a unique `x-request-id` header. Reuses an id already set on the request, so the header, the ALS store and `ctx.requestId` always agree.

```typescript
function requestId(): RequestHandler
const REQUEST_ID_HEADER = 'x-request-id'
```

### requestLogger

```typescript
function requestLogger(options?: RequestLoggerOptions): RequestHandler

interface RequestLoggerOptions {
  name?: string // logger name, default 'HTTP'
  level?: 'info' | 'debug' | 'trace' // for successful requests, default 'info'
  skip?: string[] // path prefixes not logged, e.g. ['/health', '/_debug']
}
```

### helmet

```typescript
function helmet(options?: HelmetOptions): RequestHandler

interface HelmetOptions {
  contentSecurityPolicy?: boolean | Record<string, string[]> // default: self-only policy
  noSniff?: boolean // default true
  frameguard?: false | 'DENY' | 'SAMEORIGIN' // default 'DENY'
  hsts?: false | { maxAge?: number; includeSubDomains?: boolean; preload?: boolean } // default 1 year + subdomains
  dnsPrefetch?: boolean // default false
  hidePoweredBy?: boolean // default true
  referrerPolicy?: false | string // default 'no-referrer'
  xssFilter?: boolean // X-XSS-Protection: 0, default true
}
```

### cors

```typescript
function cors(options?: CorsOptions): RequestHandler

interface CorsOptions {
  origin?: boolean | string | RegExp | (string | RegExp)[] // default false (reject); true reflects, '*' allows all
  methods?: string[] // default GET, HEAD, PUT, PATCH, POST, DELETE
  allowedHeaders?: string[] // default: reflects Access-Control-Request-Headers
  exposedHeaders?: string[]
  credentials?: boolean // default false
  maxAge?: number // preflight cache seconds, default 86400
  preflight?: boolean // answer OPTIONS with 204, default true
}
```

### allowedHosts

```typescript
function allowedHosts(options: string[] | AllowedHostsOptions): RequestHandler

interface AllowedHostsOptions {
  hosts: string[] // 'example.com' exact, '.example.com' + subdomains, '*' any
  trustForwardedHost?: boolean // read X-Forwarded-Host, default false (header is stripped)
  ignorePaths?: string[] // exact paths answered for any host (GET/HEAD only)
}
```

Usually configured with `bootstrap({ security: { allowedHosts: [...] } })`, which also exempts the health probes.

### breachPadding

```typescript
function breachPadding(options?: { maxBytes?: number }): RequestHandler // default 100
```

Pads each gzip response's header with 0 to `maxBytes - 1` random bytes, and drops `br` / `zstd` from `Accept-Encoding` so the padding applies. Not for the web entry, where the platform compresses.

### validate

Validates `body`, `query` and `params` with any schema `@forinda/kickjs-schema` detects (Zod, Valibot, Yup, Standard Schema). Failures go to `next(err)` — a 422 by default.

```typescript
function validate(
  schema: { body?: any; query?: any; params?: any },
  options?: { validationError?: ValidationErrorFactory },
): RequestHandler

type ValidationErrorFactory = (failure: ValidationFailure) => unknown
function defaultValidationError(failure: ValidationFailure): HttpException
```

`bootstrap({ validationError })` sets the factory app-wide.

### errorHandler / notFoundHandler

```typescript
function errorHandler(): (err, req, res, next) => void
function notFoundHandler(routes?: readonly MountedRoute[]): (req, res, next) => void
```

The Application passes `notFoundHandler` its mounted route table — it is the only place that knows the full path, prefix and version joined. With it, a request to a **known path with an unsupported verb** answers `405` and an `Allow` header rather than `404`:

```
DELETE /api/v1/things/1     405   Allow: GET, PATCH
```

Both responses are RFC 9457 problem details (`application/problem+json`). `bootstrap({ onNotFound })` still wins over the whole thing.

### csrf / csrfGuard

Double-submit cookie CSRF protection. `csrf()` runs before routing; `csrfGuard()` is the route-scoped `(ctx, next)` form that can exempt routes by [route flag](../guide/route-flags.md).

```typescript
function csrf(options?: CsrfOptions): RequestHandler
function csrfGuard(options?: CsrfGuardOptions): MiddlewareHandler

interface CsrfOptions {
  cookie?: string // default: '_csrf'
  header?: string // default: 'x-csrf-token'
  methods?: string[] // default: ['POST','PUT','PATCH','DELETE']
  ignorePaths?: string[]
  tokenLength?: number // bytes, default: 32
  trustedOrigins?: string[] // other origins allowed to send unsafe requests
  checkOrigin?: boolean // check Sec-Fetch-Site / Origin / Referer first, default: true
  cookieOptions?: {
    httpOnly?: boolean // default: false — the page must read the token to echo it
    sameSite?: 'strict' | 'lax' | 'none' // default: 'strict'
    secure?: boolean // default: true in production
    path?: string // default: '/'
  }
}

interface CsrfGuardOptions extends CsrfOptions {
  exemptWhen?: RouteFlagTest // e.g. 'csrf.exempt'
}
```

### session

```typescript
function session(options: SessionOptions): RequestHandler

interface SessionOptions {
  secret: string | string[] // required; a list rotates — first signs, all verify
  cookieName?: string // default 'kick.sid'
  maxAge?: number // ms, default 86400000 (24h)
  rolling?: boolean // reset maxAge on every response, default false
  saveUninitialized?: boolean // default true
  cookie?: { httpOnly?; secure?; sameSite?; path?; domain? }
  store?: SessionStore | 'cookie' // default in-memory; 'cookie' = AES-256-GCM encrypted cookie
}

interface Session {
  id: string
  data: SessionData
  regenerate(): Promise<void>
  destroy(): Promise<void>
  save(): Promise<void>
}
```

Type session keys by augmenting `SessionData` (`declare module '@forinda/kickjs' { interface SessionData { userId?: string } }`). Read it with `ctx.session`. `KvSessionStore` backs it with any KV (Workers KV, Redis-like). See the [sessions guide](../guide/sessions.md).

### rateLimit / rateLimitGuard

```typescript
function rateLimit(options?: RateLimitOptions): RequestHandler
function rateLimitGuard(options?: RateLimitGuardOptions): MiddlewareHandler // ctx-style, edge-safe

interface RateLimitOptions {
  max?: number // default 100
  windowMs?: number // default 60_000
  message?: string // default 'Too Many Requests'
  statusCode?: number // default 429
  keyGenerator?: (req) => string // default req.ip
  headers?: boolean // X-RateLimit-* headers, default true
  store?: RateLimitStore // default in-memory
  skip?: (req) => boolean
  skipPaths?: string[]
  exemptWhen?: RouteFlagTest
}

interface RateLimitStore {
  increment(key: string): Promise<{ totalHits: number; resetTime: Date }>
  decrement(key: string): Promise<void>
  reset(key: string): Promise<void>
}
```

`RateLimitGuardOptions` has the same fields, with `keyGenerator` / `skip` taking `ctx` (key defaults to `ctx.ip`). Behind a proxy set `bootstrap({ trustProxy: true })`, or every client shares one bucket. Use `KvRateLimitStore` where isolates recycle (edge). See the [rate limiting guide](../guide/rate-limiting.md).

### upload

File upload middleware built on multer (an optional peer, loaded on the first upload). Usually declared with `@FileUpload()` instead.

```typescript
const upload: {
  single(fieldName: string, options?: UploadOptions): RequestHandler
  array(fieldName: string, maxCount?: number, options?: UploadOptions): RequestHandler // maxCount default 10
  none(options?: UploadOptions): RequestHandler
}

function cleanupFiles(): RequestHandler // delete disk-stored files after the response
function resolveMimeTypes(types: string[]): string[] // 'jpg' → 'image/jpeg'
function buildUploadMiddleware(config: FileUploadConfig): RequestHandler

interface UploadOptions {
  maxSize?: number // bytes, default 5MB — over the limit answers 413
  allowedTypes?: string[] | ((mimetype: string, filename: string) => boolean) // 'jpg', 'image/*', MIME
  customMimeMap?: Record<string, string>
  storage?: MulterOptions['storage'] // default memory storage
  dest?: string // disk storage shorthand
}
```

Fastify and h3 handle uploads natively with the same limits; see the [file uploads guide](../guide/file-uploads.md).

### traceContext

```typescript
function traceContext(options?: { propagateResponse?: boolean }): RequestHandler
function parseTraceparent(header: string): TraceContext | null
const TRACEPARENT_HEADER = 'traceparent'
```

Reads or starts a W3C trace and stores it on the request store; `propagateResponse` echoes a `traceresponse` header.

### requestScopeMiddleware

```typescript
function requestScopeMiddleware(): RequestHandler
```

Opens the per-request AsyncLocalStorage frame behind `ctx.set()`, request-scoped DI and `getRequestValue()`. The Application mounts it automatically. Read the store outside a handler with `requestStore`, `getRequestStore()` or `getRequestValue(key)`.

## Views and SPA

These are adapters, passed to `bootstrap({ adapters })` — not middleware.

```typescript
ViewAdapter({ engine, ext, viewsDir?, layout? }) // viewsDir default 'src/views'
SpaAdapter({ clientDir?, apiPrefix?, exclude?, cacheControl?, ... }) // clientDir default 'dist/client'
```

```typescript
import ejs from 'ejs'
bootstrap({ modules, adapters: [ViewAdapter({ engine: ejs, ext: 'ejs' })] })
// in a controller: ctx.render('dashboard', { user })
```

`SpaAdapter` serves the built client and falls back to `index.html` for any path not under `apiPrefix` (default `'/api'`, segment-aware) or `exclude`. Also available as the `./views` and `./spa` subpaths. See the [view engines](../guide/view-engines.md) and [SPA](../guide/spa.md) guides.

## Background work

```typescript
function waitUntil(promise: Promise<unknown>): void
function settleBackgroundWork(): Promise<void>
interface PlatformContext {
  waitUntil?(promise: Promise<unknown>): void
}
```

Keeps `promise` running after the response. The Node server's `shutdown()` waits for it; `createHandler()` and the web entry hand it to the platform's `waitUntil` when you pass the platform context. Same as `ctx.waitUntil()`.

## Health module

```typescript
const healthModule: ModuleFactory<HealthModuleConfig>
const HEALTH_PROBE: InjectionToken<HealthProbe>

interface HealthProbe {
  isDraining(): boolean
  checks(): Promise<HealthCheckResult[]>
}

interface HealthModuleConfig {
  flags?: RouteFlagDeclarations // put on both probes, e.g. ['auth.public']
  checkTimeout?: number // ms per onHealthCheck(), default 2000
}
```

Mounted automatically at `/health/live` and `/health/ready`; pass `bootstrap({ health: false })` to replace it, or `bootstrap({ health: { flags: ['auth.public'] } })` to put your own [route flags](../guide/route-flags.md) on both probes. It reads draining state and adapter checks through `HEALTH_PROBE` rather than Application internals, so a replacement module can satisfy the same contract. Behaviour is documented in the [core reference](./core.md#health-endpoints).

## Metrics

```typescript
function metricsAdapter(options?: MetricsOptions): AppAdapter

interface MetricsOptions {
  path?: string // default '/metrics'
  token?: string // require Authorization: Bearer <token>
  buckets?: number[] // seconds, default Prometheus' 5ms–10s
}
```

Serves a Prometheus request-duration histogram (`RequestHistogram`). The endpoint mounts before your middleware, so set `token` unless only the scraper can reach the port.

## Query String Parsing

ORM-agnostic query string parsing for filters, sorting, pagination, and search. Also available as the `@forinda/kickjs/query` subpath.

```typescript
function parseQuery(
  query: Record<string, any>,
  fieldConfig?: QueryFieldConfig,
  options?: ParseQueryOptions,
): TypedParsedQuery
function parseFilters(
  filter: string | string[] | undefined,
  allowedFields?: string[],
  options?,
): FilterItem[]
function parseSort(
  sort: string | string[] | undefined,
  allowedFields?: string[],
  options?,
): SortItem[]
function parsePagination(
  params: { page?: string | number; limit?: string | number },
  options?: { maxLimit?: number; defaultLimit?: number },
): PaginationParams
function parseSearchQuery(q: string | undefined, options?): string
function buildQueryParams(parsed: Partial<ParsedQuery>): Record<string, string | string[] | number>

function setQueryParsingDefaults(partial: { maxLimit?; defaultLimit?; maxSearchLength? }): void
function getQueryParsingDefaults(): Readonly<{
  maxLimit
  defaultLimit
  maxSearchLength
  defaultPage
}>
function resetQueryParsingDefaults(): void // back to 100 / 20 / 200

interface ParseQueryOptions {
  maxLimit?: number // default 100
  defaultLimit?: number // default 20
  maxSearchLength?: number // default 200
  onReject?: (rejection: QueryRejection) => void // dropped field or truncated search
}
```

Query syntax: `?filter=status:eq:active&sort=createdAt:desc&page=2&limit=20&q=term`. `ctx.qs()` logs rejections with `console.warn` unless you pass `onReject`. See the [query parsing guide](../guide/query-parsing.md).

### Query Types

```typescript
type FilterOperator =
  | 'eq'
  | 'neq'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'between'
  | 'in'
  | 'contains'
  | 'starts'
  | 'ends'
const FILTER_OPERATORS: Set<string>

interface FilterItem {
  field: string
  operator: FilterOperator
  value: string
}
interface SortItem {
  field: string
  direction: 'asc' | 'desc'
}
interface PaginationParams {
  page: number
  limit: number
  offset: number
}
interface ParsedQuery {
  filters: FilterItem[]
  sort: SortItem[]
  pagination: PaginationParams
  search: string
}
/** filters[].field / sort[].field narrowed to an `as const` whitelist. */
interface TypedParsedQuery<TConfig> extends ParsedQuery {}

type QueryFieldConfig =
  | { filterable?: string[]; sortable?: string[]; searchable?: string[] }
  | { columns: Record<string, any>; sortable?: Record<string, any>; searchColumns?: any[] } // Drizzle-style

interface PaginatedResponse<T = any> {
  data: T[]
  meta: { page; limit; total; totalPages; hasNext; hasPrev }
}

interface QueryBuilderAdapter<TResult = any, TConfig = any> {
  readonly name: string
  build(parsed: ParsedQuery, config: TConfig): TResult
}
```
