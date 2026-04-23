# Third-Party Integrations

KickJS integrates with external services through **adapters** and **middleware**. This section provides step-by-step guides for common integrations.

## Monitoring & Error Tracking

- [Sentry](./sentry.md) — Error tracking, performance monitoring, distributed tracing
- Datadog *(coming soon)*
- New Relic *(coming soon)*

## Databases

- [Prisma](../../api/prisma.md) — Type-safe ORM with migration support
- [Drizzle](../../api/drizzle.md) — Lightweight type-safe query builder
- MongoDB/Mongoose — via custom adapter (see [task-mongoose-api example](https://github.com/forinda/kick-js/tree/main/examples/task-mongoose-api))

## Caching

- Redis — via `ioredis` (see [task-drizzle-api example](https://github.com/forinda/kick-js/tree/main/examples/task-drizzle-api))
- Upstash *(coming soon)*

## Email

- [Mailer](../../api/mailer.md) — SMTP, Resend, SES via `@forinda/kickjs-mailer`

## Message Queues

- [Queue](../../api/queue.md) — BullMQ, RabbitMQ, Kafka via `@forinda/kickjs-queue`

## Authentication

- [Auth](../../api/auth.md) — JWT, API key, OAuth via `@forinda/kickjs-auth`

## Observability

- [OpenTelemetry](../../api/otel.md) — Traces and metrics via `@forinda/kickjs-otel`

## Integration Pattern

All integrations follow the same adapter pattern:

```ts
import { bootstrap } from '@forinda/kickjs'
import { loadEnv } from '@forinda/kickjs-config'

const env = loadEnv(envSchema)

const adapters = [
  SwaggerAdapter({ info: { title: 'My API', version: '1.0.0' } }),
]

// Conditionally add Sentry when DSN is configured
if (env.SENTRY_DSN) {
  adapters.unshift(new SentryAdapter({ dsn: env.SENTRY_DSN }))
}

bootstrap({
  modules: [UserModule, ProductModule],
  adapters,
  middleware: [helmet(), cors(), requestId(), express.json()],
})
```

To build your own integration, see [Creating Adapters](../adapters.md).
