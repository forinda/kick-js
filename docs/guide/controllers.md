# Controllers

Controllers are the presentation layer in KickJS. They handle HTTP requests, delegate to use cases or services, and send responses. A controller is a class decorated with `@Controller()` that defines route handlers using method decorators.

## Defining a Controller

```ts
import { Controller, Get, Post, Put, Delete, Patch, Autowired } from '@kickjs/core'
import { RequestContext } from '@kickjs/http'

@Controller()
export class TodoController {
  @Autowired() private createTodoUseCase!: CreateTodoUseCase

  @Post('/', { body: createTodoSchema })
  async create(ctx: RequestContext) {
    const result = await this.createTodoUseCase.execute(ctx.body)
    ctx.created(result)
  }

  @Get('/')
  async list(ctx: RequestContext) {
    ctx.json(await this.listTodosUseCase.execute())
  }

  @Get('/:id')
  async getById(ctx: RequestContext) {
    const result = await this.getTodoUseCase.execute(ctx.params.id)
    if (!result) return ctx.notFound('Todo not found')
    ctx.json(result)
  }

  @Delete('/:id')
  async remove(ctx: RequestContext) {
    await this.deleteTodoUseCase.execute(ctx.params.id)
    ctx.noContent()
  }
}
```

## @Controller Decorator

`@Controller(path?)` registers the class in the DI container as a singleton and sets the base route path. The path defaults to `'/'`.

```ts
@Controller('/admin')  // all routes prefixed with /admin
export class AdminController { ... }
```

The controller path is combined with individual route paths. A `@Get('/stats')` inside `@Controller('/admin')` resolves to `/admin/stats`.

## Route Decorators

Five HTTP method decorators are available, each accepting an optional path and an optional validation schema:

```ts
@Get(path?, validation?)
@Post(path?, validation?)
@Put(path?, validation?)
@Delete(path?, validation?)
@Patch(path?, validation?)
```

The `validation` argument accepts Zod schemas for `body`, `query`, and `params`:

```ts
@Post('/', { body: createTodoSchema })
@Put('/:id', { body: updateTodoSchema })
@Get('/search', { query: searchQuerySchema })
```

When validation is provided, the framework runs the `validate()` middleware before the handler. See the [Validation](./validation.md) page for details.

## RequestContext

Every handler receives a `RequestContext` instance that wraps the raw Express request and response. It is generic over body, params, and query types:

```ts
class RequestContext<TBody = any, TParams = any, TQuery = any>
```

### Request data

| Property      | Type                  | Description                              |
| ------------- | --------------------- | ---------------------------------------- |
| `body`        | `TBody`               | Parsed request body                      |
| `params`      | `TParams`             | Route parameters (e.g. `/:id`)           |
| `query`       | `TQuery`              | Query string parameters                  |
| `headers`     | `IncomingHttpHeaders` | Request headers                          |
| `requestId`   | `string \| undefined` | Value of `x-request-id` header           |
| `file`        | `any`                 | Single uploaded file (with `@FileUpload`) |
| `files`       | `any[] \| undefined`  | Array of uploaded files                  |

### Query string parsing

The `qs()` method parses structured query parameters (filters, sort, pagination):

```ts
@Get('/')
async list(ctx: RequestContext) {
  const parsed = ctx.qs({
    filterable: ['status', 'priority'],
    sortable: ['createdAt', 'title'],
  })
  // parsed.filters, parsed.sort, parsed.pagination, parsed.search
}
```

### Metadata store

`ctx.set(key, value)` and `ctx.get<T>(key)` provide a per-request key-value store. Middleware can attach data (e.g. authenticated user) for handlers to read.

### Response helpers

| Method                                    | Status | Description            |
| ----------------------------------------- | ------ | ---------------------- |
| `ctx.json(data, status?)`                 | 200    | JSON response          |
| `ctx.created(data)`                       | 201    | Created resource       |
| `ctx.noContent()`                         | 204    | No body                |
| `ctx.notFound(message?)`                  | 404    | Not found error        |
| `ctx.badRequest(message)`                 | 400    | Bad request error      |
| `ctx.html(content, status?)`              | 200    | HTML response          |
| `ctx.download(buffer, filename, type?)`   | --     | File download          |

## Middleware on Controllers

Use `@Middleware()` at the class or method level. See [Middleware](./middleware.md) for the full guide.

```ts
import { Controller, Get, Middleware } from '@kickjs/core'

@Controller()
@Middleware(authMiddleware)          // runs on all routes in this controller
export class SecureController {

  @Get('/public')
  @Middleware(rateLimitMiddleware)   // runs only on this route
  async publicEndpoint(ctx: RequestContext) {
    ctx.json({ ok: true })
  }
}
```

## Dependency Injection

Use `@Autowired()` for property injection. Dependencies are resolved lazily from the DI container:

```ts
@Controller()
export class TodoController {
  @Autowired() private todoService!: TodoService
  @Autowired() private logger!: AppLogger
}
```

For constructor injection with interface tokens, use `@Inject()`:

```ts
constructor(
  @Inject(TODO_REPOSITORY) private readonly repo: ITodoRepository,
) {}
```
