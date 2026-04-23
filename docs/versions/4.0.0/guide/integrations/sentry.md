# Sentry Integration

Set up [Sentry](https://sentry.io) for error tracking, performance monitoring, and distributed tracing in your KickJS application.

## Installation

```bash
pnpm add @sentry/node
```

## Quick Setup

Create a Sentry adapter that hooks into the KickJS lifecycle:

```ts
// src/adapters/sentry.adapter.ts
import * as Sentry from '@sentry/node'
import type { AppAdapter, AdapterContext } from '@forinda/kickjs'

export interface SentryAdapterOptions {
  /** Sentry DSN from your project settings */
  dsn: string
  /** Environment name (default: NODE_ENV) */
  environment?: string
  /** Sample rate for performance tracing (0.0 to 1.0, default: 1.0 in dev, 0.1 in prod) */
  tracesSampleRate?: number
  /** Enable debug logging (default: false) */
  debug?: boolean
}

export class SentryAdapter implements AppAdapter {
  readonly name = 'SentryAdapter'

  constructor(private options: SentryAdapterOptions) {}

  beforeMount({ app, env, isProduction }: AdapterContext): void {
    Sentry.init({
      dsn: this.options.dsn,
      environment: this.options.environment ?? env,
      tracesSampleRate: this.options.tracesSampleRate ?? (isProduction ? 0.1 : 1.0),
      debug: this.options.debug ?? false,
      integrations: [
        // Automatically instrument Express routes
        Sentry.expressIntegration(),
      ],
    })

    // Sentry request handler must be the first middleware
    app.use(Sentry.expressRequestHandler())
  }

  middleware() {
    return [
      {
        // Sentry error handler runs after routes but before KickJS error handler
        handler: Sentry.expressErrorHandler(),
        phase: 'afterRoutes' as const,
      },
    ]
  }

  async shutdown(): Promise<void> {
    // Flush pending events before process exit
    await Sentry.close(2000)
  }
}
```

## Bootstrap

```ts
// src/index.ts
import 'reflect-metadata'
import express from 'express'
import { bootstrap, helmet, cors, requestId, requestLogger } from '@forinda/kickjs'
import { SwaggerAdapter } from '@forinda/kickjs-swagger'
import { loadEnv } from '@forinda/kickjs-config'
import { SentryAdapter } from './adapters/sentry.adapter'
import { modules } from './modules'

const env = loadEnv()

bootstrap({
  modules,
  adapters: [
    new SentryAdapter({
      dsn: env.SENTRY_DSN,
      tracesSampleRate: 0.1,
    }),
    SwaggerAdapter({
      info: { title: 'My API', version: '1.0.0' },
    }),
  ],
  middleware: [
    helmet(),
    cors(),
    requestId(),
    requestLogger(),
    express.json(),
  ],
})
```

## Environment Variables

```bash
# .env
SENTRY_DSN=https://examplePublicKey@o0.ingest.sentry.io/0
```

Add to your Zod env schema:

```ts
// src/config/env.ts
import { defineEnv, loadEnv } from '@forinda/kickjs-config'
import { z } from 'zod'

const envSchema = defineEnv((base) =>
  base.extend({
    SENTRY_DSN: z.string().url().optional(),
  }),
)

export const env = loadEnv(envSchema)
```

## Capturing Errors in Controllers

KickJS's error handler automatically catches thrown `HttpException` errors. To also capture them in Sentry, create a middleware:

```ts
// src/middleware/sentry-error.middleware.ts
import * as Sentry from '@sentry/node'
import type { Request, Response, NextFunction } from 'express'

export function sentryErrorCapture() {
  return (err: any, req: Request, res: Response, next: NextFunction) => {
    // Capture the error in Sentry with request context
    Sentry.withScope((scope) => {
      scope.setTag('url', req.originalUrl)
      scope.setTag('method', req.method)
      scope.setExtra('requestId', (req as any).requestId)

      if (err.statusCode && err.statusCode < 500) {
        // Client errors (4xx) — capture as breadcrumb, not error
        scope.setLevel('warning')
        Sentry.addBreadcrumb({
          message: err.message,
          category: 'http',
          level: 'warning',
          data: { statusCode: err.statusCode, url: req.originalUrl },
        })
      } else {
        // Server errors (5xx) — capture as error
        Sentry.captureException(err)
      }
    })

    next(err)
  }
}
```

Add it before the default error handler:

```ts
bootstrap({
  modules,
  adapters: [new SentryAdapter({ dsn: env.SENTRY_DSN })],
  middleware: [
    helmet(),
    cors(),
    requestId(),
    requestLogger(),
    express.json(),
    // Sentry error capture runs before KickJS error handler
    sentryErrorCapture(),
  ],
})
```

## Adding Context to Errors

Use Sentry scopes in your services to add business context:

```ts
import * as Sentry from '@sentry/node'
import { Service } from '@forinda/kickjs'

@Service()
export class PaymentService {
  async charge(userId: string, amount: number) {
    return Sentry.startSpan({ name: 'payment.charge', op: 'payment' }, async () => {
      Sentry.setUser({ id: userId })
      Sentry.setTag('payment.amount', String(amount))

      try {
        const result = await this.gateway.charge(userId, amount)
        return result
      } catch (err) {
        Sentry.setExtra('failedAmount', amount)
        throw err // Will be captured by the error middleware
      }
    })
  }
}
```

## Performance Monitoring

Sentry automatically traces Express routes. To add custom spans for database queries or external calls:

```ts
import * as Sentry from '@sentry/node'

@Service()
export class UserRepository {
  async findById(id: string) {
    return Sentry.startSpan(
      { name: 'db.user.findById', op: 'db.query', attributes: { 'db.statement': 'SELECT * FROM users WHERE id = ?' } },
      async () => {
        return this.db.user.findUnique({ where: { id } })
      },
    )
  }
}
```

## Distributed Tracing with RequestContext

Connect Sentry traces with KickJS's request ID:

```ts
// src/middleware/sentry-context.middleware.ts
import * as Sentry from '@sentry/node'
import type { Request, Response, NextFunction } from 'express'

export function sentryContext() {
  return (req: Request, res: Response, next: NextFunction) => {
    const requestId = (req as any).requestId || req.headers['x-request-id']

    if (requestId) {
      Sentry.setTag('request_id', requestId)
    }

    next()
  }
}
```

Add after `requestId()` in the middleware pipeline:

```ts
middleware: [
  requestId(),
  sentryContext(),  // Links request ID to Sentry traces
  requestLogger(),
  express.json(),
],
```

## Conditional Setup

Only enable Sentry when a DSN is configured:

```ts
const env = loadEnv(envSchema)

const adapters = [
  SwaggerAdapter({ info: { title: 'My API', version: '1.0.0' } }),
]

if (env.SENTRY_DSN) {
  adapters.unshift(
    new SentryAdapter({
      dsn: env.SENTRY_DSN,
      // tracesSampleRate uses isProduction from AdapterContext automatically
    }),
  )
}

bootstrap({ modules, adapters, middleware: [...] })
```

## Source Maps

For readable stack traces in production, upload source maps during your build:

```bash
pnpm add -D @sentry/cli
```

```bash
# After kick build
npx sentry-cli sourcemaps upload \
  --org your-org \
  --project your-project \
  --release v$(node -p "require('./package.json').version") \
  dist/
```

Or add to your CI pipeline:

```yaml
- name: Upload source maps to Sentry
  run: npx sentry-cli sourcemaps upload --org $ORG --project $PROJECT --release $VERSION dist/
  env:
    SENTRY_AUTH_TOKEN: ${{ secrets.SENTRY_AUTH_TOKEN }}
```

## Testing

In tests, Sentry is not initialized (no DSN), so it's a no-op. No special mocking needed:

```ts
const { expressApp } = await createTestApp({
  modules: [UserModule],
  // No SentryAdapter — errors go to KickJS error handler only
})
```

## Configuration Reference

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `dsn` | `string` | *required* | Sentry project DSN |
| `environment` | `string` | `NODE_ENV` | Environment tag |
| `tracesSampleRate` | `number` | `1.0` dev / `0.1` prod | Performance sampling rate |
| `debug` | `boolean` | `false` | Enable Sentry debug logging |
