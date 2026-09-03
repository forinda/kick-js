# HTTP layer

Runtime-agnostic HTTP layer with a declarative middleware pipeline, request context, routing, and query string parsing. The engine is pluggable — Express (default), Fastify or h3 — selected with `bootstrap({ runtime })`.

Exported from `@forinda/kickjs`; there is no separate `@forinda/kickjs-http` package.

## Application

Wires the chosen engine, the DI container, modules, adapters and middleware.

```typescript
class Application {
  constructor(options: ApplicationOptions)

  setup(): Promise<void>
  start(): Promise<void>
  rebuild(): Promise<void>
  shutdown(options?: ShutdownOptions): Promise<void>

  /** The Node request listener, following whichever runtime is configured. */
  handle(req: IncomingMessage, res: ServerResponse, next?: (err?: any) => void): void

  getRuntimeApp(): ActiveRuntime['app']
  getActiveRuntime(): { name: string; capabilities: RuntimeCapabilities }
  /** Express-only — throws under Fastify or h3. Prefer `handle` or `getRuntimeApp`. */
  getExpressApp(): Express
  getHttpServer(): http.Server | null
}
```

`setup`, `start`, `rebuild` and `shutdown` are all **async**.

Use `handle` to drive the app in tests or to mount it inside another server — it is engine-neutral, where `getExpressApp()` throws on any runtime but Express.

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

## RequestContext

Unified request/response abstraction passed to every controller method.

```typescript
class RequestContext<TBody = any, TParams = any, TQuery = any> {
  readonly req: Request
  readonly res: Response
  readonly next: NextFunction

  get body(): TBody
  get params(): TParams
  get query(): TQuery
  get headers(): IncomingHttpHeaders
  get requestId(): string | undefined
  get file(): any
  get files(): any[] | undefined

  qs(fieldConfig?: QueryFieldConfig): ParsedQuery
  get<T = any>(key: string): T | undefined
  set(key: string, value: any): void

  // Response helpers
  json(data: any, status?: number): Response
  created(data: any): Response
  noContent(): Response
  notFound(message?: string): Response
  badRequest(message: string): Response
  html(content: string, status?: number): Response
  download(buffer: Buffer, filename: string, contentType?: string): Response

  // Template rendering (requires ViewAdapter)
  render(template: string, data?: Record<string, any>): void

  // Pagination — parses query, fetches data, returns paginated JSON
  paginate<T>(
    fetcher: (parsed: ParsedQuery) => Promise<{ data: T[]; total: number }>,
    fieldConfig?: QueryFieldConfig,
  ): Promise<Response>

  // Server-Sent Events
  sse(): {
    send(data: any, event?: string, id?: string): void
    comment(text: string): void
    onClose(fn: () => void): void
    close(): void
  }
}
```

## Router Builder

```typescript
function buildRoutes(controllerClass: any, options?: BuildRoutesOptions): Router
function getControllerPath(controllerClass: any): string

interface BuildRoutesOptions {
  /**
   * Extra contributors merged into the per-route pipeline at their declared
   * precedence. Pass explicitly when calling this outside the Application's
   * route-mount loop — typically in tests. Omitted, it falls back to the slot
   * set by `Application.setup()`.
   */
  externalSources?: readonly SourcedRegistration[]
}
```

- **buildRoutes** -- Builds an Express Router from a decorated controller class, resolving it from the DI container.
- **getControllerPath** -- Returns the path prefix set by `@Controller()`.

## Middleware

All of the below are exported from `@forinda/kickjs` and mounted through `bootstrap({ middlewares: [...] })`, in the order you declare.

| Middleware                         | Purpose                                                                  |
| ---------------------------------- | ------------------------------------------------------------------------ |
| `requestId()`                      | Generate / propagate `x-request-id`                                      |
| `requestLogger()`                  | Pino request logging — types: `LoggedRequest`, `LoggedResponse`          |
| `helmet()`                         | Security headers. Auto-injected with defaults; declare it to change them |
| `cors()`                           | CORS with spec-correct preflight                                         |
| `csrf()`                           | Double-submit cookie CSRF                                                |
| `session()`                        | Cookie sessions                                                          |
| `rateLimit()` / `rateLimitGuard()` | Rate limiting, pluggable store (`KvRateLimitStore`)                      |
| `validate()`                       | Body / query / params schema validation                                  |
| `upload()`                         | Multipart file handling                                                  |
| `traceContext()`                   | W3C `traceparent` propagation                                            |
| `views()` / `spa()`                | Server-rendered views, SPA fallback                                      |

::: tip Declaring `helmet()` turns off the automatic one
The framework auto-injects `helmet()` unless `security.helmet` is `false`. Declaring your own stands that down — which is what makes its options work. Before v8 both ran, and the second could only add a header, never drop one, so `helmet({ frameguard: false })` still emitted `DENY`.
:::

### requestId

Generates or propagates a unique `x-request-id` header.

```typescript
function requestId(): RequestHandler
const REQUEST_ID_HEADER = 'x-request-id'
```

### validate

Validates `req.body`, `req.query`, and `req.params` against schemas with `.safeParse()`.

```typescript
function validate(schema: { body?: any; query?: any; params?: any }): RequestHandler
```

### errorHandler / notFoundHandler

```typescript
function errorHandler(): ErrorRequestHandler
function notFoundHandler(routes?: readonly MountedRoute[]): RequestHandler
```

The Application passes `notFoundHandler` its mounted route table — it is the only place that knows the full path, prefix and version joined. With it, a request to a **known path with an unsupported verb** answers `405` and an `Allow` header rather than `404`:

```
DELETE /api/v1/things/1     405   Allow: GET, PATCH
```

Both responses are RFC 9457 problem details (`application/problem+json`). `bootstrap({ onNotFound })` still wins over the whole thing.

### csrf

Double-submit cookie CSRF protection.

```typescript
function csrf(options?: CsrfOptions): RequestHandler

interface CsrfOptions {
  cookie?: string // default: '_csrf'
  header?: string // default: 'x-csrf-token'
  methods?: string[] // default: ['POST','PUT','PATCH','DELETE']
  ignorePaths?: string[]
  tokenLength?: number // default: 32
  cookieOptions?: {
    httpOnly?: boolean // default: false — the page must read the token to echo it
    sameSite?: 'strict' | 'lax' | 'none' // default: 'strict'
    secure?: boolean // default: true in production
    path?: string // default: '/'
  }
}
```

### upload

File upload middleware built on multer.

```typescript
const upload: {
  single(fieldName: string, options?: UploadOptions): RequestHandler
  array(fieldName: string, maxCount?: number, options?: UploadOptions): RequestHandler
  none(options?: UploadOptions): RequestHandler
}

function cleanupFiles(): RequestHandler

interface UploadOptions {
  maxSize?: number // default: 5MB
  allowedTypes?: string[]
  storage?: MulterOptions['storage']
  dest?: string
}
```

## Returning a response

```typescript
function reply(status: number, body?: unknown): HandlerResult
function isReply(value: unknown): value is HandlerResult
function applyHandlerResult(ctx: RequestContext, result: unknown): void
```

`return reply(status, body)` from a handler carries the status without touching the engine-native response. Prefer it to `ctx.res.status(...)` — `ctx.res` is a `FastifyReply` under Fastify, which has no `.json()`. Every runtime routes a handler's return value through `applyHandlerResult`.

## Health module

```typescript
const healthModule: ModuleFactory
const HEALTH_PROBE: InjectionToken<HealthProbe>

interface HealthProbe {
  isDraining(): boolean
  runChecks(): Promise<HealthCheckResult[]>
}
```

Mounted automatically at `/health/live` and `/health/ready`; pass `bootstrap({ health: false })` to replace it. It reads draining state and adapter checks through `HEALTH_PROBE` rather than Application internals, so a replacement module can satisfy the same contract. Behaviour and the v8 mounting change are documented in the [core reference](./core.md#health-endpoints).

## Query String Parsing

ORM-agnostic query string parsing for filters, sorting, pagination, and search.

```typescript
function parseQuery(query: Record<string, any>, fieldConfig?: QueryFieldConfig): ParsedQuery
function parseFilters(
  filterParam: string | string[] | undefined,
  allowedFields?: string[],
): FilterItem[]
function parseSort(sortParam: string | string[] | undefined, allowedFields?: string[]): SortItem[]
function parsePagination(params: {
  page?: string | number
  limit?: string | number
}): PaginationParams
function parseSearchQuery(q: string | undefined): string
function buildQueryParams(parsed: Partial<ParsedQuery>): Record<string, string | string[] | number>
```

### Query Types

```typescript
type FilterOperator =
  'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'between' | 'in' | 'contains' | 'starts' | 'ends'

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
interface QueryFieldConfig {
  filterable?: string[]
  sortable?: string[]
  searchable?: string[]
}

interface QueryBuilderAdapter<TResult = any, TConfig = any> {
  readonly name: string
  build(parsed: ParsedQuery, config: TConfig): TResult
}
```
