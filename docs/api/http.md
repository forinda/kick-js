# @forinda/kickjs-http

Express-based HTTP layer with declarative middleware pipeline, request context, routing, and query string parsing.

## Application

Main application class that wires Express, the DI container, modules, adapters, and middleware.

```typescript
class Application {
  constructor(options: ApplicationOptions)
  setup(): void
  start(): void
  rebuild(): void
  shutdown(): Promise<void>
  getExpressApp(): Express
  getHttpServer(): http.Server | null
}

interface ApplicationOptions {
  modules: AppModuleClass[]
  adapters?: AppAdapter[]
  port?: number
  apiPrefix?: string | false    // default: '/api', false to disable prefix + versioning
  defaultVersion?: number       // default: 1
  middleware?: MiddlewareEntry[]
  trustProxy?: boolean | number | string | ((ip: string, hopIndex: number) => boolean)
  jsonLimit?: string | number
}

type MiddlewareEntry =
  | RequestHandler
  | { path: string; handler: RequestHandler }
```

## bootstrap

Zero-boilerplate entry point. Handles Vite HMR, graceful shutdown, and global error handlers.

```typescript
function bootstrap(options: ApplicationOptions): void
```

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
function buildRoutes(controllerClass: any): Router
function getControllerPath(controllerClass: any): string
```

- **buildRoutes** -- Builds an Express Router from a decorated controller class, resolving it from the DI container.
- **getControllerPath** -- Returns the path prefix set by `@Controller('/path')`.

## Middleware

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
function notFoundHandler(): RequestHandler
```

### csrf

Double-submit cookie CSRF protection.

```typescript
function csrf(options?: CsrfOptions): RequestHandler

interface CsrfOptions {
  cookie?: string           // default: '_csrf'
  header?: string           // default: 'x-csrf-token'
  methods?: string[]        // default: ['POST','PUT','PATCH','DELETE']
  ignorePaths?: string[]
  tokenLength?: number      // default: 32
  cookieOptions?: { httpOnly?: boolean; sameSite?: 'strict'|'lax'|'none'; secure?: boolean; path?: string }
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
  maxSize?: number          // default: 5MB
  allowedTypes?: string[]
  storage?: MulterOptions['storage']
  dest?: string
}
```

## Query String Parsing

ORM-agnostic query string parsing for filters, sorting, pagination, and search.

```typescript
function parseQuery(query: Record<string, any>, fieldConfig?: QueryFieldConfig): ParsedQuery
function parseFilters(filterParam: string | string[] | undefined, allowedFields?: string[]): FilterItem[]
function parseSort(sortParam: string | string[] | undefined, allowedFields?: string[]): SortItem[]
function parsePagination(params: { page?: string | number; limit?: string | number }): PaginationParams
function parseSearchQuery(q: string | undefined): string
function buildQueryParams(parsed: Partial<ParsedQuery>): Record<string, string | string[] | number>
```

### Query Types

```typescript
type FilterOperator = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'between' | 'in' | 'contains' | 'starts' | 'ends'

interface FilterItem { field: string; operator: FilterOperator; value: string }
interface SortItem { field: string; direction: 'asc' | 'desc' }
interface PaginationParams { page: number; limit: number; offset: number }
interface ParsedQuery { filters: FilterItem[]; sort: SortItem[]; pagination: PaginationParams; search: string }
interface QueryFieldConfig { filterable?: string[]; sortable?: string[]; searchable?: string[] }

interface QueryBuilderAdapter<TResult = any, TConfig = any> {
  readonly name: string
  build(parsed: ParsedQuery, config: TConfig): TResult
}
```
