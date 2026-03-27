# Decorators Reference

KickJS provides 22 decorators across `@forinda/kickjs-core` and `@forinda/kickjs-swagger`. This page is a complete reference for all of them.

## Class Decorators

### @Controller(path?)

Marks a class as an HTTP controller and registers it in the DI container.

```ts
import { Controller } from '@forinda/kickjs-core'

@Controller('/users')
class UserController { ... }

@Controller()  // defaults to '/'
class RootController { ... }
```

### @Service(options?)

Marks a class as a service (singleton by default).

```ts
import { Service, Scope } from '@forinda/kickjs-core'

@Service()
class UserService { ... }

@Service({ scope: Scope.TRANSIENT })  // new instance per resolution
class RequestScopedService { ... }
```

### @Injectable(options?)

Generic version of `@Service`. Same behavior, different semantic meaning.

### @Component(options?)

Alias for `@Injectable`. Use for classes that don't fit the "service" or "repository" naming.

### @Repository(options?)

Semantic alias for `@Injectable`. Use for data access classes.

```ts
@Repository()
class UserRepository {
  async findById(id: string) { ... }
}
```

## Method Decorators — HTTP Routes

### @Get(path?, validation?)

### @Post(path?, validation?)

### @Put(path?, validation?)

### @Delete(path?, validation?)

### @Patch(path?, validation?)

Map a controller method to an HTTP route. Optionally pass Zod schemas for request validation.

```ts
import { Controller, Get, Post, Put, Delete, Patch } from '@forinda/kickjs-core'
import { z } from 'zod'

const createUserSchema = z.object({ name: z.string(), email: z.string().email() })
const updateUserSchema = createUserSchema.partial()

@Controller('/users')
class UserController {
  @Get('/')
  async list(ctx: RequestContext) { ... }

  @Get('/:id')
  async getById(ctx: RequestContext) { ... }

  @Post('/', { body: createUserSchema })
  async create(ctx: RequestContext) { ... }  // ctx.body is validated

  @Put('/:id', { body: updateUserSchema })
  async update(ctx: RequestContext) { ... }

  @Patch('/:id', { body: updateUserSchema })
  async patch(ctx: RequestContext) { ... }

  @Delete('/:id')
  async remove(ctx: RequestContext) { ... }
}
```

**Validation options:**

| Key | Type | Description |
|-----|------|-------------|
| `body` | Zod schema | Validate `req.body` |
| `query` | Zod schema | Validate `req.query` |
| `params` | Zod schema | Validate `req.params` |

## Method Decorators — Lifecycle & Behavior

### @PostConstruct()

Marks a method to be called after the class is instantiated and dependencies are injected.

```ts
@Service()
class CacheService {
  @PostConstruct()
  async warmup() {
    await this.loadFromRedis()
  }
}
```

## Method & Class Decorators

### @Middleware(...handlers)

Attach middleware to a class (all routes) or a specific method. Handlers receive `(ctx: RequestContext, next: () => void)`.

```ts
import { Controller, Get, Middleware } from '@forinda/kickjs-core'

// Class-level — applies to all routes
@Controller('/admin')
@Middleware(authMiddleware, roleMiddleware('admin'))
class AdminController {
  @Get('/')
  async dashboard(ctx: RequestContext) { ... }

  // Method-level — applies only to this route
  @Get('/danger')
  @Middleware(rateLimitMiddleware)
  async dangerousAction(ctx: RequestContext) { ... }
}
```

### @FileUpload(config)

Configures file upload handling. The router builder auto-attaches the upload middleware from this metadata — no need for `@Middleware(upload.single(...))`.

```ts
import { Controller, Post, FileUpload } from '@forinda/kickjs-core'

@Controller('/files')
class FileController {
  @Post('/avatar')
  @FileUpload({
    mode: 'single',
    fieldName: 'avatar',
    maxSize: 5 * 1024 * 1024,
    allowedTypes: ['jpg', 'png', 'webp'],
  })
  async uploadAvatar(ctx: RequestContext) {
    ctx.json({ file: ctx.file.originalname })
  }

  @Post('/documents')
  @FileUpload({
    mode: 'array',
    fieldName: 'docs',
    maxCount: 10,
    allowedTypes: (mime) => mime === 'application/pdf',
  })
  async uploadDocs(ctx: RequestContext) {
    ctx.json({ count: ctx.files?.length })
  }
}
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `mode` | `'single' \| 'array' \| 'none'` | **required** | Upload mode |
| `fieldName` | `string` | `'file'` | Form field name |
| `maxCount` | `number` | `10` | Max files (array mode) |
| `maxSize` | `number` | 5MB | Max file size in bytes |
| `allowedTypes` | `string[] \| function` | all | Accepts extensions, MIME types, wildcards, or filter function |
| `customMimeMap` | `Record<string, string>` | — | Extend built-in MIME map |

## Property Decorators

### @Autowired(token?)

Inject a dependency by type or token. Resolved lazily from the DI container.

```ts
@Controller('/users')
class UserController {
  @Autowired() private userService!: UserService          // By type
  @Autowired(CACHE_TOKEN) private cache!: CacheService    // By token
}
```

### @Value(envKey, defaultValue?)

Inject an environment variable value. Evaluated lazily at access time.

```ts
@Service()
class EmailService {
  @Value('SMTP_HOST') private host!: string
  @Value('SMTP_PORT', 587) private port!: number
}
```

## Parameter Decorators

### @Inject(token)

Inject a dependency by token in constructor parameters.

```ts
@Service()
class NotificationService {
  constructor(@Inject(MAILER_TOKEN) private mailer: Mailer) {}
}
```

## Class Decorator — Utility

### @Builder

Adds a static `builder()` method for fluent construction.

```ts
import { Builder } from '@forinda/kickjs-core'

@Builder
class UserDto {
  name!: string
  email!: string
  role!: string
}

const user = UserDto.builder().name('Alice').email('alice@example.com').role('admin').build()
```

## Swagger Decorators

These are from `@forinda/kickjs-swagger` and generate OpenAPI documentation from your controllers.

### @ApiOperation(options)

Describe an endpoint for the OpenAPI spec.

```ts
import { ApiOperation } from '@forinda/kickjs-swagger'

@Get('/')
@ApiOperation({ summary: 'List all users', description: 'Returns paginated user list' })
async list(ctx: RequestContext) { ... }
```

### @ApiResponse(options)

Document a response status code and schema.

```ts
import { ApiResponse } from '@forinda/kickjs-swagger'

@Post('/')
@ApiResponse({ status: 201, description: 'User created', schema: userSchema })
@ApiResponse({ status: 400, description: 'Validation failed' })
async create(ctx: RequestContext) { ... }
```

### @ApiTags(...tags)

Group endpoints under tags in the Swagger UI. Works on classes or methods.

```ts
@Controller('/users')
@ApiTags('Users')
class UserController { ... }
```

### @ApiBearerAuth(name?)

Mark endpoints as requiring Bearer token authentication.

```ts
@Controller('/admin')
@ApiBearerAuth()
class AdminController { ... }
```

### @ApiExclude()

Hide a controller or method from the generated OpenAPI spec.

```ts
@Get('/internal')
@ApiExclude()
async internalEndpoint(ctx: RequestContext) { ... }
```

### @ApiQueryParams(config)

Declares the filterable, sortable, and searchable query parameters for an endpoint. This decorator lives in `@forinda/kickjs-core` and works with both the query parser and the Swagger spec generator. When `@forinda/kickjs-swagger` is installed, the declared fields are automatically added as OpenAPI query parameters.

Accepts **both** string-based configs and column-object configs (e.g., `DrizzleQueryParamsConfig`):

```ts
import { Controller, Get, ApiQueryParams } from '@forinda/kickjs-core'
import { RequestContext } from '@forinda/kickjs-http'

// String-based config
@Controller('/tasks')
class TaskController {
  @Get('/')
  @ApiQueryParams({
    filterable: ['status', 'priority', 'assigneeId'],
    sortable: ['createdAt', 'title', 'priority'],
    searchable: ['title', 'description'],
  })
  async list(ctx: RequestContext) {
    return ctx.paginate(
      (parsed) => this.taskService.findPaginated(parsed),
      { filterable: ['status', 'priority', 'assigneeId'], sortable: ['createdAt', 'title'] },
    )
  }
}
```

**With Drizzle Column objects** — pass your `DrizzleQueryParamsConfig` directly:

```ts
import { TASK_QUERY_CONFIG } from '../constants'

@Controller('/tasks')
class TaskController {
  @Get('/')
  @ApiQueryParams(TASK_QUERY_CONFIG) // Column objects → field names extracted automatically
  async list(ctx: RequestContext) {
    return ctx.paginate(
      (parsed) => this.taskService.findPaginated(parsed),
      TASK_QUERY_CONFIG,
    )
  }
}
```

| String-based option | Column-based option | Description |
|--------|------|-------------|
| `filterable: string[]` | `columns: Record<string, Column>` | Fields that clients can filter on via `?filter=field:op:value` |
| `sortable: string[]` | `sortable: Record<string, Column>` | Fields that clients can sort by via `?sort=field:direction` |
| `searchable: string[]` | `searchColumns: Column[]` | Fields included in free-text `?q=` search |

## Summary Table

| Decorator | Target | Package | Purpose |
|-----------|--------|---------|---------|
| `@Controller` | Class | core | HTTP controller with route prefix |
| `@Service` | Class | core | DI-registered service |
| `@Injectable` | Class | core | Generic DI registration |
| `@Component` | Class | core | Alias for Injectable |
| `@Repository` | Class | core | Data access class |
| `@Get/Post/Put/Delete/Patch` | Method | core | HTTP route handler |
| `@PostConstruct` | Method | core | Post-instantiation hook |
| `@Middleware` | Class/Method | core | Attach middleware |
| `@FileUpload` | Method | core | Configure file upload |
| `@Autowired` | Property | core | Property injection |
| `@Value` | Property | core | Env variable injection |
| `@Inject` | Parameter | core | Constructor param injection |
| `@Builder` | Class | core | Fluent builder pattern |
| `@ApiOperation` | Method | swagger | OpenAPI operation |
| `@ApiResponse` | Method | swagger | OpenAPI response |
| `@ApiTags` | Class/Method | swagger | OpenAPI tags |
| `@ApiBearerAuth` | Class/Method | swagger | Bearer auth scheme |
| `@ApiQueryParams` | Method | core | Declare filterable/sortable/searchable query fields |
| `@ApiExclude` | Class/Method | swagger | Hide from spec |
