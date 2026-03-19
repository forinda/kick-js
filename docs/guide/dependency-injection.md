# Dependency Injection

KickJS has a built-in lightweight IoC container with no external dependencies. It supports constructor injection, property injection, factory registration, and lifecycle hooks.

## Registering Services

### Decorators

```typescript
import { Service, Repository, Component, Injectable } from '@kickjs/core'

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

Use `@Inject` when the type doesn't match the token (e.g., interface bindings):

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

Use `@Autowired` for lazy property injection:

```typescript
@Controller()
class OrderController {
  @Autowired() private orderService!: OrderService
  @Autowired() private logger!: Logger
}
```

Properties are resolved lazily on first access, not at construction time.

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

## Configuration Classes

Use `@Configuration` and `@Bean` for factory method patterns:

```typescript
@Configuration()
class AppConfig {
  @Bean()
  createMailer(): MailService {
    return new MailService({ apiKey: process.env.MAIL_KEY })
  }
}
```

Bean methods are invoked during `container.bootstrap()` and their return values are registered as singletons.

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
|-------|----------|
| `SINGLETON` (default) | One instance shared across the application |
| `TRANSIENT` | New instance created on every `resolve()` call |

## Circular Dependency Detection

The container detects circular dependencies and throws with the full resolution chain:

```
Error: Circular dependency detected: OrderService -> PaymentService -> OrderService
```

## Testing

Reset the container between tests for isolation:

```typescript
import { Container } from '@kickjs/core'

beforeEach(() => {
  Container.reset()
})
```
