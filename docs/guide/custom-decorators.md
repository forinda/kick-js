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

::: tip Use kickjs's metadata helpers, not raw `Reflect`
The framework re-exports `setClassMeta` / `pushClassMeta` / `getClassMeta` / `setMethodMeta` / `getMethodMeta` from `@forinda/kickjs`. They wrap `Reflect.defineMetadata` / `Reflect.getMetadata` with typed returns, sensible fallbacks, and the v4 string-key convention (`'app/<area>/<key>'` for adopter code, `'kick/<area>/<key>'` for first-party). Round-tripping through the same helpers means DevTools introspection, typegen, and the lint rules can see your metadata. Don't import `reflect-metadata` yourself — the framework already does at startup.
:::

```ts
import { setMethodMeta, getMethodMetaOrUndefined } from '@forinda/kickjs'

const ROLES_KEY = 'app/auth/roles'

/** Restrict a route to specific roles */
function Roles(...roles: string[]): MethodDecorator {
  return (target, propertyKey) => {
    setMethodMeta<string[]>(ROLES_KEY, roles, target, propertyKey as string)
  }
}

/** Read roles from a handler */
function getRoles(target: object, handlerName: string): string[] {
  return getMethodMetaOrUndefined<string[]>(ROLES_KEY, target, handlerName) ?? []
}
```

Usage:

```ts
@Controller()
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
import { createLogger } from '@forinda/kickjs/logger'

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
import { setMethodMeta, getMethodMetaOrUndefined } from '@forinda/kickjs'

const SCHEMA_KEY = 'app/validation/body'

/** Attach a Zod schema for request body validation */
function Body(schema: z.ZodType): MethodDecorator {
  return (target, propertyKey) => {
    setMethodMeta<z.ZodType>(SCHEMA_KEY, schema, target, propertyKey as string)
  }
}

/** Read the schema (used by middleware or route builder) */
function getBodySchema(target: object, handlerName: string): z.ZodType | undefined {
  return getMethodMetaOrUndefined<z.ZodType>(SCHEMA_KEY, target, handlerName)
}
```

## Pattern 6: Class Decorator with DI

Register something in the DI container when a class is decorated:

```ts
import { Container, Scope } from '@forinda/kickjs'

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

## Pattern 7: Custom Queue Provider

KickJS ships with BullMQ via `@forinda/kickjs-queue`, but you can create your own queue provider for RabbitMQ, SQS, Kafka, or any other backend. Implement the `QueueProvider` interface and the `@Job`/`@Process` decorators work unchanged.

```ts
import type { QueueProvider } from '@forinda/kickjs-queue'
import amqplib from 'amqplib'

export class RabbitMQProvider implements QueueProvider {
  private connection: amqplib.Connection | null = null
  private channel: amqplib.Channel | null = null

  constructor(private url: string) {}

  private async ensureChannel() {
    if (!this.channel) {
      this.connection = await amqplib.connect(this.url)
      this.channel = await this.connection.createChannel()
    }
    return this.channel
  }

  async addJob(queue: string, name: string, data: any) {
    const ch = await this.ensureChannel()
    await ch.assertQueue(queue, { durable: true })
    ch.sendToQueue(queue, Buffer.from(JSON.stringify({ name, data })))
  }

  createWorker(
    queue: string,
    processor: (job: { name: string; data: any }) => Promise<void>,
  ) {
    this.ensureChannel().then(async (ch) => {
      await ch.assertQueue(queue, { durable: true })
      ch.consume(queue, async (msg) => {
        if (!msg) return
        const job = JSON.parse(msg.content.toString())
        await processor(job)
        ch.ack(msg)
      })
    })
  }

  async shutdown() {
    await this.channel?.close()
    await this.connection?.close()
  }
}
```

Then use it with the existing adapter by passing your provider, or create a custom adapter that accepts it. The `@Job` and `@Process` decorators are just metadata — they work with any queue backend.

## Tips

- **Use slash-delimited string keys** — `'app/<area>/<key>'` for adopter code, `'kick/<area>/<key>'` for framework code (lint enforces the second). Symbols were the v3 convention; v4 standardised on strings so DevTools / typegen / lint can introspect them
- **Keep decorators small** — a decorator should do one thing; compose for complex behavior
- **Don't mutate the class** — decorators should add metadata or wrap methods, not change class structure
- **Test with `getClassMeta()` / `getMethodMeta()`** — verify your decorator stores the right data through the same helpers your reader uses
- **Use `descriptor.value` for sync, handle async** — check if the original returns a Promise

## Related

- [Decorators Reference](./decorators.md) — all built-in decorators
- [Context Decorators](./context-decorators.md) — the typed `defineContextDecorator()` factory; preferred over a hand-written class/method decorator when the goal is to populate `ctx.set/get` keys before the handler
- [DI Container](../api/core.md) — how `Container`, `@Service`, `@Inject` work
- [Middleware](./getting-started.md) — `@Middleware` decorator for Express middleware
