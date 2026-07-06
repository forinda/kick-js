# Dependency Injection

KickJS has a built-in lightweight IoC container with no external dependencies. It supports constructor injection, property injection, factory registration, and lifecycle hooks.

## Registering Services

### Decorators

```typescript
import { Service, Repository, Component, Injectable } from '@forinda/kickjs'

@Service() // Semantic alias — business logic (singleton)
class UserService {}

@Repository() // Semantic alias — data access (singleton)
class UserRepository {}

@Component() // Generic managed component (singleton)
class EmailClient {}

@Injectable({ scope: Scope.TRANSIENT }) // New instance per resolve
class RequestLogger {}
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

Use `@Inject` when the type doesn't match the token — typically for **interface bindings**. `@Inject` and `@Autowired` are interchangeable in both constructor-parameter and property positions; pick whichever name reads better at the call site.

The recommended way to declare a non-class token is `createToken<T>(name)`. The returned token is a frozen object identified by reference, so collisions are impossible by construction, and the phantom type parameter `T` flows through `container.resolve()` and `@Inject()` automatically:

```typescript
import { createToken, Inject, Service } from '@forinda/kickjs'

interface IOrderRepository {
  findById(id: string): Promise<Order | null>
}

// Type-safe DI token. The `<IOrderRepository>` is the contract;
// the `'OrderRepository'` string is just a label for error messages.
export const ORDER_REPO = createToken<IOrderRepository>('OrderRepository')

@Service()
class OrderService {
  constructor(
    @Inject(ORDER_REPO) private repo: IOrderRepository,
    //                              ↑ this annotation is now just documentation —
    //                                container.resolve(ORDER_REPO) already returns IOrderRepository
  ) {}
}
```

## Property Injection

Use `@Autowired` for lazy property injection. For token-based property injection, pass the token to `@Autowired`:

```typescript
@Controller()
class OrderController {
  @Autowired() private orderService!: OrderService // resolved by class type
  @Autowired() private logger!: Logger // resolved by class type
  @Autowired(ORDER_REPO) private repo!: IOrderRepository // resolved by typed token
}
```

Properties are resolved lazily on first access, not at construction time.

::: tip @Inject vs @Autowired
The two names are interchangeable — same runtime, same types. Both work in either position:

| Form                                   | Where                             | Resolves by                                         |
| -------------------------------------- | --------------------------------- | --------------------------------------------------- |
| `@Autowired(token)` / `@Inject(token)` | Property or constructor parameter | Explicit token (`createToken<T>`, class, or string) |
| `@Autowired()` / `@Inject()`           | Property or constructor parameter | Inferred type (from TypeScript metadata)            |

Pick the name that reads better at the call site; the framework treats them identically.
:::

## DI Token Hardening

KickJS supports four kinds of DI tokens. Pick the safest one that fits your case — the list below is ordered from safest to riskiest.

- **Class identity** — `container.resolve(UserService)` returns `UserService`. JS reference equality means two classes can never collide; type safety comes from the `Constructor<T>` overload on `Container.resolve`. Use this whenever the thing you want to resolve **is** a class.

- **`createToken<T>(name)`** — `container.resolve(USER_REPO)` returns `IUserRepository`. Each call returns a unique frozen object identified by reference, not by the `name` string, so two `createToken<X>('foo')` calls in different files produce two distinct tokens. Type safety comes from the `InjectionToken<T>` overload. **Use this for interface bindings, third-party clients, factory results, and anything else that isn't a class.**

  ```ts
  export const USER_REPO = createToken<IUserRepository>('UserRepository')
  ```

- **`Symbol('foo')`** — `container.resolve(SYM)` returns `any`. Discouraged. The symbol is unique per call (no collisions in practice) but the call site is untyped — you have to add a generic at every injection site, and a refactor that misses one usage site won't be caught at compile time. Note: `Symbol.for(...)` is interned and **does** collide across files; never use it for DI tokens.

- **Raw string `@Inject('string')`** — high collision risk. Untyped unless `kick typegen` has populated `KickJsRegistry`. Another developer registering `'config'` somewhere else silently overrides yours. Only use this for runtime-computed token names where the literal string genuinely isn't known at compile time.

**Recommendation: use `createToken<T>` for everything that isn't a class.** It removes both collision risk and the need for separate type annotations on every injection site. The CLI generators (`kick g module`, `kick g scaffold`) emit `createToken<T>` by default for repository tokens.

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

However, when injecting by **token** — typically for interface-based bindings — you **must** register the token → implementation mapping in your module's `register()` method. Interfaces don't exist at runtime, so the container has no way to resolve them automatically:

```typescript
import { createToken, Repository, type AppModule } from '@forinda/kickjs'

// 1. Define the interface and a typed token
interface IUserRepository {
  findById(id: string): Promise<User | null>
}

export const USER_REPO = createToken<IUserRepository>('UserRepository')

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
  // routes() { ... }
}

// 4. Now inject by token — fully typed, no manual annotation
@Controller()
class UserController {
  @Autowired(USER_REPO) private repo!: IUserRepository  // resolved via module binding
}
```

This pattern lets you swap implementations (e.g., `InMemoryUserRepository` → `DrizzleUserRepository`) by changing only the module registration — no changes needed in controllers or services.

> **`AppModule.register()` is optional.** Modules whose classes are entirely decorator-managed (`@Service`, `@Controller`, `@Repository`) don't need to implement it — only declare it when you need to bind a token to a concrete implementation.

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

### @PreDestroy

The teardown counterpart. For REQUEST-scoped services it runs when the
request's scope closes (response finished or aborted) — release per-request
resources there:

```ts
@Service({ scope: Scope.REQUEST })
class TxService {
  @PostConstruct()
  begin() {
    this.tx = db.beginTransaction()
  }

  @PreDestroy()
  async close() {
    await this.tx.rollbackIfOpen()
  }
}
```

Hooks may be async; errors are logged and swallowed so one failing teardown
can't break request completion.

## Environment Injection

Use `@Value` to inject environment variables. When `kick typegen` has populated the project's `KickEnv` global from `src/env.ts`, the key autocompletes and the `Env<K>` type alias resolves to the schema-inferred type — see [Configuration](configuration.md) and [Type Generation](typegen.md#how-env-vars-are-typed) for the full pipeline.

```typescript
import { Service, Value, type Env } from '@forinda/kickjs'

@Service()
class ApiClient {
  @Value('API_BASE_URL') baseUrl!: Env<'API_BASE_URL'>
  @Value('API_TIMEOUT', '5000') timeout!: Env<'API_TIMEOUT'>
  // @Value('NOPE') bad!: string  // ❌ tsc error if KickEnv is populated
}
```

If the env var is missing and no default is provided, accessing the property throws with a clear error message.

## Scopes

| Scope                 | Behavior                                                       |
| --------------------- | -------------------------------------------------------------- |
| `SINGLETON` (default) | One instance shared across the application                     |
| `TRANSIENT`           | New instance created on every `resolve()` call                 |
| `REQUEST`             | One instance per HTTP request, cached for the request lifetime |

## Request-Scoped DI

Request-scoped services get a fresh instance for each HTTP request. Within the same request, every `resolve()` call returns the same cached instance. When the request ends, the instance is automatically garbage collected — no manual cleanup needed.

Under the hood this uses Node's `AsyncLocalStorage`, so it works correctly even with concurrent requests.

### Setup

Nothing — request-scoped DI works out of the box. `bootstrap()` opens an
`AsyncLocalStorage` frame around every request automatically, so
`Scope.REQUEST` services resolve correctly without any manual wiring.

If you need to control _where_ the frame opens (for example, to keep a
tracing wrapper outside it so spans see the raw request), include
`requestScopeMiddleware()` in your `middleware` list explicitly. KickJS
detects an explicit mount and skips the default placement, so you never
end up with a doubled frame:

```typescript
import { bootstrap, requestScopeMiddleware } from '@forinda/kickjs'

bootstrap({
  modules: [
    /* ... */
  ],
  middlewares: [
    tracing(),
    requestScopeMiddleware(), // mount here instead of the default position
    // ... other middleware
  ],
})
```

### Declaring a Request-Scoped Service

`getRequestValue(key)` is keyed off the augmentable `ContextMeta`
registry — augment it once at module level and every read from that
key gets the right type without `as` casts:

```typescript
declare module '@forinda/kickjs' {
  interface ContextMeta {
    tenantId: string
    currentUser: { id: string; email: string; tenantId: string }
  }
}
```

```typescript
import { Service, Scope, Autowired, getRequestValue } from '@forinda/kickjs'

@Service({ scope: Scope.REQUEST })
class TenantContext {
  get tenantId(): string {
    // typed as `string | undefined` thanks to the ContextMeta augmentation
    return getRequestValue('tenantId') ?? ''
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

@Controller()
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

Need a value computed once per request and visible to every downstream
handler and request-scoped service? Use a [Context Contributor](context-decorators.md) — a typed,
ordered, declarative way to populate the request frame before the
handler runs:

Because these contributors touch `ctx.req.headers`, use
`defineHttpContextDecorator` — the HTTP-typed wrapper that binds `ctx`
to `RequestContext` so `ctx.req` is available and typed. Use plain
`defineContextDecorator` only for transport-agnostic contributors that
read `ctx.get(...)` and nothing else:

```typescript
import { defineHttpContextDecorator } from '@forinda/kickjs'

const LoadCurrentUser = defineHttpContextDecorator({
  key: 'currentUser',
  resolve: async (ctx) => verifyToken(ctx.req.headers.authorization),
})

const LoadTenantId = defineHttpContextDecorator({
  key: 'tenantId',
  dependsOn: ['currentUser'],
  resolve: (ctx) => ctx.get('currentUser')!.tenantId,
})

@Controller()
class DashboardController {
  @LoadCurrentUser
  @LoadTenantId
  @Get('/me')
  show(ctx: RequestContext) {
    return ctx.json({
      user: ctx.get('currentUser'),
      tenant: ctx.get('tenantId'),
    })
  }
}
```

Inside any `Scope.REQUEST` service, read the same value with
`getRequestValue(key)`. The return type comes from the `ContextMeta`
augmentation above — there is no value-type generic, so don't write
`getRequestValue<string>(...)`:

```typescript
import { Service, Scope, getRequestValue } from '@forinda/kickjs'

@Service({ scope: Scope.REQUEST })
class CurrentUserService {
  get tenantId(): string | null {
    // typed via ContextMeta['tenantId'] — `string | undefined`
    return getRequestValue('tenantId') ?? null
  }
}
```

`getRequestValue()` returns `MetaValue<K> | undefined` — typed via
`ContextMeta[K]` when augmented, falling back to `unknown` when the
key isn't registered. It also returns `undefined` outside a request
frame (background jobs, startup, tests without a request), which is
intentional: service code that runs in both request and non-request
paths doesn't throw.

For ad-hoc writes from inside a handler, use `ctx.set('key', value)`.
A controller-side write is appropriate when the value depends on
already-running handler logic; for everything else, prefer a contributor
so the dependency graph is explicit and order is enforced.

### Scope Compatibility Rules

Not all scope combinations are valid. The container enforces these rules at resolve time:

| Parent scope | Can inject SINGLETON? | Can inject TRANSIENT? | Can inject REQUEST?   |
| ------------ | --------------------- | --------------------- | --------------------- |
| `SINGLETON`  | Yes                   | Yes                   | **No** — throws error |
| `TRANSIENT`  | Yes                   | Yes                   | Yes                   |
| `REQUEST`    | Yes                   | Yes                   | Yes                   |

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
