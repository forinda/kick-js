# Dependency Injection

KickJS has a built-in lightweight IoC container with no external dependencies. It supports constructor injection, property injection, factory registration, and lifecycle hooks.

## Registering Services

### Decorators

```typescript
import { Service, Repository, Component, Injectable } from '@forinda/kickjs'

@Service()     // Semantic alias — business logic (singleton)
class UserService { }

@Repository()  // Semantic alias — data access (singleton)
class UserRepository { }

@Component()   // Generic managed component (singleton)
class EmailClient { }

@Injectable({ scope: Scope.TRANSIENT })  // New instance per resolve
class RequestLogger { }
```

All four decorators register the class in the DI container. The difference is semantic — use the one that best describes your class's purpose.

## Constructor Injection

```typescript
@Service()
class OrderService {
  constructor(
    private userService: UserService,
    private emailClient: EmailClient,
  ) {}
}
```

TypeScript's `emitDecoratorMetadata` resolves constructor parameter types automatically.

### Explicit Token Override

Use `@Inject` when the type doesn't match the token (e.g., interface bindings). **`@Inject` is for constructor parameters only** — it does not work as a property decorator.

```typescript
const ORDER_REPO = Symbol('OrderRepository')

@Service()
class OrderService {
  constructor(
    @Inject(ORDER_REPO) private repo: IOrderRepository,
  ) {}
}
```

## Property Injection

Use `@Autowired` for lazy property injection. For token-based property injection, pass the token to `@Autowired`:

```typescript
@Controller()
class OrderController {
  @Autowired() private orderService!: OrderService         // resolved by class type
  @Autowired() private logger!: Logger                     // resolved by class type
  @Autowired(ORDER_REPO) private repo!: IOrderRepository   // resolved by token
}
```

Properties are resolved lazily on first access, not at construction time.

::: tip @Inject vs @Autowired
| Decorator | Where | Resolves by |
|---|---|---|
| `@Inject(token)` | Constructor parameters only | Explicit token (Symbol, string) |
| `@Autowired()` | Class properties only | Class type (from TypeScript metadata) |
| `@Autowired(token)` | Class properties only | Explicit token |

Using `@Inject` on a property causes a TypeScript compile error (`TS1240`). Use `@Autowired(token)` instead.
:::

## When You Need Manual Registration

Classes decorated with `@Service()`, `@Controller()`, or `@Repository()` are **auto-registered** in the DI container — you don't need to register them in your module. `@Autowired()` resolves them by class type automatically:

```typescript
@Service()
class EmailService { ... }  // auto-registered by @Service()

@Controller()
class UserController {
  @Autowired() private emailService!: EmailService  // just works — no manual setup
}
```

However, when injecting by **token** (Symbol) — typically for interface-based bindings — you **must** register the token → implementation mapping in your module's `register()` method. Interfaces don't exist at runtime, so the container has no way to resolve them automatically:

```typescript
// 1. Define the interface and token
const USER_REPO = Symbol('UserRepository')

interface IUserRepository {
  findById(id: string): Promise<User | null>
}

// 2. Implement it (auto-registered as a class, but NOT bound to the token)
@Repository()
class InMemoryUserRepository implements IUserRepository { ... }

// 3. Bind the token to the implementation in your module
class UserModule implements AppModule {
  register(container: Container) {
    container.registerFactory(USER_REPO, () =>
      container.resolve(InMemoryUserRepository),
    )
  }
  // ...
}

// 4. Now inject by token
@Controller()
class UserController {
  @Autowired(USER_REPO) private repo!: IUserRepository  // resolved via module binding
}
```

This pattern lets you swap implementations (e.g., `InMemoryUserRepository` → `DrizzleUserRepository`) by changing only the module registration — no changes needed in controllers or services.

## Factory Registration

Register factories for complex initialization or third-party instances:

```typescript
// In your module
register(container: Container): void {
  // Factory — called once (singleton)
  container.registerFactory(DATABASE, () => {
    return createDrizzle(process.env.DATABASE_URL)
  })

  // Pre-constructed instance
  container.registerInstance(REDIS, redisClient)

  // Bind interface to implementation
  container.registerFactory(ORDER_REPO, () =>
    container.resolve(DrizzleOrderRepository)
  )
}
```

## Lifecycle Hooks

### @PostConstruct

Called immediately after the instance is fully constructed (all injections resolved):

```typescript
@Service()
class CacheService {
  @PostConstruct()
  async init() {
    await this.warmCache()
  }
}
```

## Environment Injection

Use `@Value` to inject environment variables:

```typescript
@Service()
class ApiClient {
  @Value('API_BASE_URL') baseUrl!: string
  @Value('API_TIMEOUT', '5000') timeout!: string
}
```

If the env var is missing and no default is provided, accessing the property throws with a clear error message.

## Scopes

| Scope | Behavior |
| ------- | ---------- |
| `SINGLETON` (default) | One instance shared across the application |
| `TRANSIENT` | New instance created on every `resolve()` call |
| `REQUEST` | One instance per HTTP request, cached for the request lifetime |

## Request-Scoped DI

Request-scoped services get a fresh instance for each HTTP request. Within the same request, every `resolve()` call returns the same cached instance. When the request ends, the instance is automatically garbage collected — no manual cleanup needed.

Under the hood this uses Node's `AsyncLocalStorage`, so it works correctly even with concurrent requests.

### Setup

Mount `requestScopeMiddleware()` early in your middleware pipeline (before route handlers):

```typescript
import { bootstrap, requestScopeMiddleware } from '@forinda/kickjs'

bootstrap({
  modules: [/* ... */],
  middleware: [
    requestScopeMiddleware(),  // enables REQUEST-scoped DI
    // ... other middleware
  ],
})
```

### Declaring a Request-Scoped Service

```typescript
import { Service, Scope, Autowired } from '@forinda/kickjs'
import { getRequestStore } from '@forinda/kickjs'

@Service({ scope: Scope.REQUEST })
class TenantContext {
  get tenantId(): string {
    return getRequestStore().values.get('tenantId')
  }
}

@Service({ scope: Scope.REQUEST })
class RequestTransaction {
  private tx: DbTransaction | null = null

  async begin() {
    this.tx = await db.beginTransaction()
  }

  async commit() {
    await this.tx?.commit()
    this.tx = null
  }

  get transaction() {
    return this.tx
  }
}

@Controller('/orders')
class OrderController {
  @Autowired() private tenantCtx!: TenantContext
  @Autowired() private txn!: RequestTransaction

  @Post('/')
  async create(ctx: RequestContext) {
    // tenantCtx and txn are unique to this request
    await this.txn.begin()
    // ...
  }
}
```

### When to Use Request Scope

- **Tenant context** — resolve the current tenant once per request and inject it everywhere
- **Database transactions** — share a single transaction across services within one request
- **Session / auth state** — carry authenticated user info without passing it through every method
- **Request-local caches** — avoid redundant lookups within the same request

### Pre-Registered Request Values

Middleware can store values in the request store before controllers run. Use `getRequestStore().values.set()` to make data available for injection:

```typescript
import { getRequestStore } from '@forinda/kickjs'

// In auth middleware
function authMiddleware() {
  return async (req, res, next) => {
    const user = await verifyToken(req.headers.authorization)
    getRequestStore().values.set('currentUser', user)
    getRequestStore().values.set('tenantId', user.tenantId)
    next()
  }
}
```

These values can then be read inside any request-scoped service via `getRequestStore().values.get()`.

### Scope Compatibility Rules

Not all scope combinations are valid. The container enforces these rules at resolve time:

| Parent scope | Can inject SINGLETON? | Can inject TRANSIENT? | Can inject REQUEST? |
| --- | --- | --- | --- |
| `SINGLETON` | Yes | Yes | **No** — throws error |
| `TRANSIENT` | Yes | Yes | Yes |
| `REQUEST` | Yes | Yes | Yes |

A `SINGLETON` lives for the entire application lifetime, while a `REQUEST`-scoped instance is destroyed after each request. If a singleton held a reference to a request-scoped service, it would point to a stale instance after the request ends. The container prevents this by throwing:

```
Error: Cannot inject REQUEST-scoped "TenantContext" into SINGLETON "OrderService".
Singletons outlive requests. Use TRANSIENT or REQUEST scope for the parent.
```

If a singleton needs request-scoped data, resolve it explicitly inside a method call rather than injecting it as a dependency.

## Circular Dependency Detection

The container detects circular dependencies and throws with the full resolution chain:

```
Error: Circular dependency detected: OrderService -> PaymentService -> OrderService
```

## Testing

Reset the container between tests for isolation:

```typescript
import { Container } from '@forinda/kickjs'

beforeEach(() => {
  Container.reset()
})
```
