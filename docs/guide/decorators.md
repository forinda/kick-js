# Decorators Reference

KickJS provides 22 decorators across `@forinda/kickjs` and `@forinda/kickjs-swagger`. This page is a complete reference for all of them.

## Class Decorators

### @Controller()

Marks a class as an HTTP controller and registers it in the DI container. Takes no arguments — route prefixes are defined by the module's `routes().path`, the single source of truth for where routes mount. The legacy `@Controller('/path')` form was removed in v4; see [Migration v3 → v4](./migration-v3-to-v4.md) for the rename map.

```ts
import { Controller } from '@forinda/kickjs'

@Controller()
class UserController { ... }
```

### @Service(options?)

Marks a class as a service (singleton by default).

```ts
import { Service, Scope } from '@forinda/kickjs'

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
import { Controller, Get, Post, Put, Delete, Patch } from '@forinda/kickjs'
import { z } from 'zod'

const createUserSchema = z.object({ name: z.string(), email: z.string().email() })
const updateUserSchema = createUserSchema.partial()

@Controller()
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

| Key      | Type       | Description           |
| -------- | ---------- | --------------------- |
| `body`   | Zod schema | Validate `req.body`   |
| `query`  | Zod schema | Validate `req.query`  |
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
import { Controller, Get, Middleware } from '@forinda/kickjs'

// Class-level — applies to all routes
@Controller()
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
import { Controller, Post, FileUpload } from '@forinda/kickjs'

@Controller()
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

| Option          | Type                            | Default      | Description                                                   |
| --------------- | ------------------------------- | ------------ | ------------------------------------------------------------- |
| `mode`          | `'single' \| 'array' \| 'none'` | **required** | Upload mode                                                   |
| `fieldName`     | `string`                        | `'file'`     | Form field name                                               |
| `maxCount`      | `number`                        | `10`         | Max files (array mode)                                        |
| `maxSize`       | `number`                        | 5MB          | Max file size in bytes                                        |
| `allowedTypes`  | `string[] \| function`          | all          | Accepts extensions, MIME types, wildcards, or filter function |
| `customMimeMap` | `Record<string, string>`        | —            | Extend built-in MIME map                                      |

## Injection Decorators

### @Autowired(token?) and @Inject(token?)

Inject a dependency by inferred type or explicit token. The two names are interchangeable — same runtime, same types. Pick whichever reads better at the call site. Each works in two positions:

```ts
@Controller()
class UserController {
  // Property position — both names work.
  @Autowired() private userService!: UserService // resolved by type
  @Inject(CACHE_TOKEN) private cache!: CacheService // resolved by token

  // Constructor-parameter position — both names work.
  constructor(
    @Inject(MAILER_TOKEN) private mailer: Mailer,
    @Autowired() private logger: Logger,
  ) {}
}
```

Property-position injections resolve lazily on first access. Constructor-position injections resolve at instantiation. The no-token form (`@Autowired()` / `@Inject()`) relies on TypeScript's `emitDecoratorMetadata` to resolve by the property's declared type or the constructor parameter's type.

### @Value(envKey, defaultValue?)

Inject an environment variable value. Property-position only. Evaluated lazily at access time.

```ts
@Service()
class EmailService {
  @Value('SMTP_HOST') private host!: string
  @Value('SMTP_PORT', 587) private port!: number
}
```

## Class Decorator — Utility

### @Builder

Adds a static `builder()` method for fluent construction. KickJS uses TypeScript's legacy decorators (`experimentalDecorators: true`), which cannot widen a class type from a decorator return value, so the runtime side effect and the type opt-in are decoupled. Pick whichever ergonomics you prefer — the runtime is identical.

#### Decorator form (with type opt-in)

```ts
import { Builder, type BuilderOf } from '@forinda/kickjs'

@Builder
class UserDto {
  name!: string
  email!: string
  role!: string

  declare static readonly builder: () => BuilderOf<UserDto>
}

const user = UserDto.builder().name('Alice').email('alice@example.com').role('admin').build()
//                            ^? (value: string) => BuilderOf<UserDto>
```

The `declare static readonly` line is the one-time opt-in that exposes the chainable setters and `.build()` to TypeScript. Without it the runtime still works, but you get no autocomplete. `readonly` silences SonarQube's `typescript:S1444` — the runtime assigns `target.builder` once at decoration time and never reassigns it.

#### Factory form (zero boilerplate)

`withBuilder()` runs the same runtime under the hood and returns the class intersected with the typed `builder()` static, so no `declare` line is needed:

```ts
import { withBuilder } from '@forinda/kickjs'

class UserDtoBase {
  name!: string
  email!: string
  role!: string
}

export const UserDto = withBuilder(UserDtoBase)
export type UserDto = InstanceType<typeof UserDto>

const user = UserDto.builder().name('Alice').email('a@b.com').role('admin').build()
```

Use the decorator form when you want to keep one class declaration; use the factory when you'd rather not maintain the `declare static` line.

#### `BuilderOf<T>` shape

```ts
type BuilderOf<T> = { [K in keyof T]-?: (value: T[K]) => BuilderOf<T> } & {
  build(): T
}
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
@Controller()
@ApiTags('Users')
class UserController { ... }
```

### @ApiBearerAuth(name?)

Mark endpoints as requiring Bearer token authentication. Convenience over `@ApiSecurity('BearerAuth')` — also auto-synthesizes a bearer-shaped scheme under the given name (defaults to `'BearerAuth'`).

```ts
@Controller()
@ApiBearerAuth()
class AdminController { ... }

@Controller()
class CustomAuthController {
  @Get('/')
  @ApiBearerAuth('ApiKeyAuth') // custom scheme name; still bearer-shaped
  list() {}
}
```

### @ApiSecurity(requirement)

Generic security decorator. Pick this when the scheme isn't bearer-shaped (API key, OAuth2 with scopes, OpenID Connect) or when a route accepts multiple alternative schemes. Class-level cascades to every method; method-level overrides win.

```ts
import { ApiSecurity } from '@forinda/kickjs-swagger'

@Controller('/users')
@ApiSecurity('BearerAuth') // class-level default
class UsersController {
  @Get('/me')
  @ApiSecurity({ name: 'OAuth2', scopes: ['users:read'] }) // override + scopes
  me() {}

  @Get('/multi')
  @ApiSecurity(['BearerAuth', { name: 'ApiKey' }]) // alternatives
  multi() {}
}
```

Three input shapes: a string (single scheme, no scopes), an object (`{ name, scopes? }` for OAuth2 / OIDC scopes), or an array of either (multiple alternative schemes). Custom scheme names other than `'BearerAuth'` must be declared under `SwaggerOptions.securitySchemes` — see the [Swagger guide](./swagger.md#declaring-security-schemes).

### @ApiPublic()

Mark a single method as publicly accessible — opts out of any class-level security requirement (set via `@ApiSecurity` or `@ApiBearerAuth`).

```ts
@Controller('/internal')
@ApiSecurity('BearerAuth')
class InternalController {
  @Get('/health')
  @ApiPublic() // overrides class-level BearerAuth
  health() {}
}
```

Use when a mostly-secured controller exposes a health-check / login / public-stats endpoint that shouldn't carry the inherited security requirement.

### @ApiExclude()

Hide a controller or method from the generated OpenAPI spec.

```ts
@Get('/internal')
@ApiExclude()
async internalEndpoint(ctx: RequestContext) { ... }
```

### @ApiQueryParams(config)

Declares the filterable, sortable, and searchable query parameters for an endpoint. This decorator lives in `@forinda/kickjs` and works with both the query parser and the Swagger spec generator. When `@forinda/kickjs-swagger` is installed, the declared fields are automatically added as OpenAPI query parameters.

Accepts **both** string-based configs and column-object configs (e.g., `DrizzleQueryParamsConfig`):

```ts
import { Controller, Get, ApiQueryParams } from '@forinda/kickjs'
import { RequestContext } from '@forinda/kickjs'

// String-based config
@Controller()
class TaskController {
  @Get('/')
  @ApiQueryParams({
    filterable: ['status', 'priority', 'assigneeId'],
    sortable: ['createdAt', 'title', 'priority'],
    searchable: ['title', 'description'],
  })
  async list(ctx: RequestContext) {
    return ctx.paginate((parsed) => this.taskService.findPaginated(parsed), {
      filterable: ['status', 'priority', 'assigneeId'],
      sortable: ['createdAt', 'title'],
    })
  }
}
```

**With Drizzle Column objects** — pass your `DrizzleQueryParamsConfig` directly:

```ts
import { TASK_QUERY_CONFIG } from '../constants'

@Controller()
class TaskController {
  @Get('/')
  @ApiQueryParams(TASK_QUERY_CONFIG) // Column objects → field names extracted automatically
  async list(ctx: RequestContext) {
    return ctx.paginate((parsed) => this.taskService.findPaginated(parsed), TASK_QUERY_CONFIG)
  }
}
```

| String-based option    | Column-based option                | Description                                                    |
| ---------------------- | ---------------------------------- | -------------------------------------------------------------- |
| `filterable: string[]` | `columns: Record<string, Column>`  | Fields that clients can filter on via `?filter=field:op:value` |
| `sortable: string[]`   | `sortable: Record<string, Column>` | Fields that clients can sort by via `?sort=field:direction`    |
| `searchable: string[]` | `searchColumns: Column[]`          | Fields included in free-text `?q=` search                      |

## Summary Table

| Decorator                    | Target               | Package | Purpose                                             |
| ---------------------------- | -------------------- | ------- | --------------------------------------------------- |
| `@Controller`                | Class                | core    | Mark class as HTTP controller (prefix from module)  |
| `@Service`                   | Class                | core    | DI-registered service                               |
| `@Injectable`                | Class                | core    | Generic DI registration                             |
| `@Component`                 | Class                | core    | Alias for Injectable                                |
| `@Repository`                | Class                | core    | Data access class                                   |
| `@Get/Post/Put/Delete/Patch` | Method               | core    | HTTP route handler                                  |
| `@PostConstruct`             | Method               | core    | Post-instantiation hook                             |
| `@Middleware`                | Class/Method         | core    | Attach middleware                                   |
| `@FileUpload`                | Method               | core    | Configure file upload                               |
| `@Autowired`                 | Property / Parameter | core    | Dependency injection — either position works        |
| `@Value`                     | Property             | core    | Env variable injection                              |
| `@Inject`                    | Property / Parameter | core    | Dependency injection — alias for `@Autowired`       |
| `@Builder`                   | Class                | core    | Fluent builder via static `builder()` (opt-in type) |
| `withBuilder()` (factory)    | Class                | core    | Same runtime as `@Builder` with inferred typing     |
| `@ApiOperation`              | Method               | swagger | OpenAPI operation                                   |
| `@ApiResponse`               | Method               | swagger | OpenAPI response                                    |
| `@ApiTags`                   | Class/Method         | swagger | OpenAPI tags                                        |
| `@ApiBearerAuth`             | Class/Method         | swagger | Bearer-token scheme (auto-synthesized)              |
| `@ApiSecurity`               | Class/Method         | swagger | Generic security requirement (any scheme + scopes)  |
| `@ApiPublic`                 | Method               | swagger | Opt-out from class-level security                   |
| `@ApiQueryParams`            | Method               | core    | Declare filterable/sortable/searchable query fields |
| `@ApiExclude`                | Class/Method         | swagger | Hide from spec                                      |

## See also

- [Context Decorators](./context-decorators.md) — the typed `defineContextDecorator()` primitive for populating `ctx.set/get` keys before the handler. Use this instead of `@Middleware()` when the only job is to compute a value other code reads off `ctx`.
- [Custom Decorators](./custom-decorators.md) — patterns for authoring your own decorators using `reflect-metadata`.
