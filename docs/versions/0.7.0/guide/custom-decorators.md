# Creating Custom Decorators

KickJS is built on TypeScript decorators and `reflect-metadata`. You can create your own decorators to extend the framework without waiting for built-in support. This guide shows the patterns used internally so you can build decorators that feel native.

## Prerequisites

Ensure your `tsconfig.json` has:

```json
{
  "compilerOptions": {
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true
  }
}
```

And import `reflect-metadata` once at your entry point:

```ts
import 'reflect-metadata'
```

## Decorator Types

TypeScript has four decorator types. Each receives different arguments:

| Type | Signature | Use Case |
|------|-----------|----------|
| **Class** | `(target: Function)` | Mark a class (e.g., `@Service`, `@Controller`) |
| **Method** | `(target, propertyKey, descriptor)` | Wrap or annotate methods (e.g., `@Get`, `@Transactional`) |
| **Property** | `(target, propertyKey)` | Mark properties (e.g., `@Autowired`) |
| **Parameter** | `(target, propertyKey, parameterIndex)` | Tag constructor params (e.g., `@Inject`) |

## Pattern 1: Metadata Decorator

Store metadata on a class or method for later retrieval. This is how `@Controller`, `@Get`, and `@ApiOperation` work.

```ts
const ROLES_KEY = Symbol('roles')

/** Restrict a route to specific roles */
function Roles(...roles: string[]): MethodDecorator {
  return (target, propertyKey) => {
    Reflect.defineMetadata(ROLES_KEY, roles, target, propertyKey)
  }
}

/** Read roles from a handler */
function getRoles(target: any, handlerName: string): string[] {
  return Reflect.getMetadata(ROLES_KEY, target.prototype, handlerName) ?? []
}
```

Usage:

```ts
@Controller('/admin')
class AdminController {
  @Get('/')
  @Roles('admin', 'superadmin')
  dashboard(ctx: RequestContext) {
    return ctx.json({ message: 'Admin panel' })
  }
}
```

## Pattern 2: Method Wrapper Decorator

Wrap a method to add behavior before/after execution. This is how you'd build `@Transactional`, `@Cache`, or `@Log`.

```ts
/** Wrap a service method in a database transaction */
function Transactional(): MethodDecorator {
  return (_target, _propertyKey, descriptor: PropertyDescriptor) => {
    const original = descriptor.value

    descriptor.value = function (...args: any[]) {
      // `this` is the service instance — access `this.db` if injected
      const db = (this as any).db
      if (!db?.transaction) {
        return original.apply(this, args)
      }
      return db.transaction((tx: any) => {
        // Temporarily swap db for the transaction
        const prev = (this as any).db
        ;(this as any).db = tx
        try {
          return original.apply(this, args)
        } finally {
          ;(this as any).db = prev
        }
      })
    }

    return descriptor
  }
}
```

Usage:

```ts
@Service()
class OrderService {
  constructor(@Inject(DRIZZLE_DB) private db: AppDatabase) {}

  @Transactional()
  createOrder(userId: number, items: CartItem[]) {
    // All queries here run in a single transaction
    const order = this.db.insert(orders).values({ userId }).returning().get()
    for (const item of items) {
      this.db.insert(orderItems).values({ orderId: order.id, ...item }).run()
    }
    return order
  }
}
```

## Pattern 3: Timing / Logging Decorator

```ts
import { createLogger } from '@forinda/kickjs-core/logger'

const log = createLogger('Perf')

/** Log execution time of a method */
function Timed(): MethodDecorator {
  return (_target, propertyKey, descriptor: PropertyDescriptor) => {
    const original = descriptor.value
    const name = String(propertyKey)

    descriptor.value = async function (...args: any[]) {
      const start = performance.now()
      try {
        return await original.apply(this, args)
      } finally {
        log.info(`${name} took ${(performance.now() - start).toFixed(2)}ms`)
      }
    }

    return descriptor
  }
}
```

## Pattern 4: Caching Decorator

```ts
const cache = new Map<string, { data: any; expiresAt: number }>()

/** Cache the return value for `ttlMs` milliseconds */
function Cache(ttlMs: number): MethodDecorator {
  return (_target, propertyKey, descriptor: PropertyDescriptor) => {
    const original = descriptor.value
    const name = String(propertyKey)

    descriptor.value = async function (...args: any[]) {
      const key = `${name}:${JSON.stringify(args)}`
      const cached = cache.get(key)

      if (cached && cached.expiresAt > Date.now()) {
        return cached.data
      }

      const result = await original.apply(this, args)
      cache.set(key, { data: result, expiresAt: Date.now() + ttlMs })
      return result
    }

    return descriptor
  }
}
```

Usage:

```ts
@Service()
class ProductService {
  @Cache(60_000) // cache for 1 minute
  findAll() {
    return this.db.select().from(products).all()
  }
}
```

## Pattern 5: Validation Decorator

Combine with Zod for type-safe input validation:

```ts
import { z } from 'zod'

const SCHEMA_KEY = Symbol('bodySchema')

/** Attach a Zod schema for request body validation */
function Body(schema: z.ZodType): MethodDecorator {
  return (target, propertyKey) => {
    Reflect.defineMetadata(SCHEMA_KEY, schema, target, propertyKey)
  }
}

/** Read the schema (used by middleware or route builder) */
function getBodySchema(target: any, handlerName: string): z.ZodType | undefined {
  return Reflect.getMetadata(SCHEMA_KEY, target.prototype, handlerName)
}
```

## Pattern 6: Class Decorator with DI

Register something in the DI container when a class is decorated:

```ts
import { Container, Scope } from '@forinda/kickjs-core'

/** Mark a class as a repository and register it as a singleton */
function Repository(): ClassDecorator {
  return (target: any) => {
    const container = Container.getInstance()
    container.register(target, Scope.SINGLETON)
  }
}
```

## Composing Decorators

Decorators compose naturally — stack them to combine behaviors:

```ts
@Service()
class AnalyticsService {
  constructor(@Inject(DRIZZLE_DB) private db: AppDatabase) {}

  @Timed()
  @Cache(30_000)
  @Roles('admin')
  getReport(ctx: RequestContext) {
    return this.db.select().from(events).all()
  }
}
```

Decorators execute **bottom-up** — `@Roles` runs first, then `@Cache`, then `@Timed`.

## Tips

- **Use Symbols for metadata keys** — avoids collisions between libraries
- **Keep decorators small** — a decorator should do one thing; compose for complex behavior
- **Don't mutate the class** — decorators should add metadata or wrap methods, not change class structure
- **Test with `Reflect.getMetadata()`** — verify your decorator stores the right data
- **Use `descriptor.value` for sync, handle async** — check if the original returns a Promise

## Related

- [Decorators Reference](./decorators.md) — all built-in decorators
- [DI Container](../api/core.md) — how `Container`, `@Service`, `@Inject` work
- [Middleware](./getting-started.md) — `@Middleware` decorator for Express middleware
