# KickJS

A production-grade, decorator-driven Node.js framework built on Express 5 and TypeScript.

NestJS ergonomics without the complexity — decorators, DI, module system, and code generators, powered by Zod and Vite.

## Install Manually

```bash
pnpm init
pnpm add @forinda/kickjs express reflect-metadata zod
pnpm add -D @forinda/kickjs-cli
```

## Scaffold with CLI

```bash
# Using npx
npx @forinda/kickjs-cli new my-api
# Using global install
pnpm add -g @forinda/kickjs-cli
kick new my-api
# pnpm
pnpm dlx @forinda/kickjs-cli new my-api
# yarn
yarn dlx @forinda/kickjs-cli new my-api
```

## Quick Start

```bash
kick new my-api && cd my-api && kick dev
```

## Hello World

```typescript
import 'reflect-metadata'
import { Controller, Get, Service, Autowired, bootstrap, RequestContext } from '@forinda/kickjs'

@Service()
class GreetService {
  greet(name: string) { return `Hello ${name}` }
}

@Controller()
class HelloController {
  @Autowired() private greet!: GreetService

  @Get('/')
  handle(ctx: RequestContext) {
    ctx.json({ message: this.greet.greet('KickJS') })
  }
}

bootstrap({ modules: [/* your modules */] })
```

## What's Included

Everything you need for a production API — one import:

```typescript
import {
  // DI + Decorators
  Controller, Get, Post, Put, Delete, Patch,
  Service, Repository, Autowired, Inject, Value, Middleware,

  // Application
  bootstrap, Application, RequestContext, buildRoutes,

  // Middleware
  helmet, cors, csrf, rateLimit, requestId, requestLogger,
  validate, upload, session,

  // Utilities
  Container, HttpException, createLogger,
  ref, computed, watch,
  parseQuery, normalizePath,

  // Types
  type AppAdapter, type AdapterContext, type AppModule,
  type MiddlewareHandler, type ModuleRoutes,
} from '@forinda/kickjs'
```

## Typed Adapter Hooks

```typescript
import type { AppAdapter, AdapterContext } from '@forinda/kickjs'

class MyAdapter implements AppAdapter {
  name = 'MyAdapter'

  beforeMount({ app, container, isProduction }: AdapterContext) {
    // app: Express, container: Container, isProduction: boolean
    app.use(myMiddleware())
  }

  afterStart({ server }: AdapterContext) {
    // server: http.Server — attach WebSocket, etc.
  }

  async shutdown() {
    await cleanup()
  }
}
```

## Ecosystem

| Package | Description |
|---------|-------------|
| `@forinda/kickjs` | Core framework (DI, decorators, Express 5, middleware) |
| `@forinda/kickjs-config` | Zod-based env validation, ConfigService, `@Value` |
| `@forinda/kickjs-swagger` | Auto OpenAPI from decorators + Zod schemas |
| `@forinda/kickjs-cli` | Scaffolding, DDD generators, custom commands |
| `@forinda/kickjs-testing` | `createTestApp`, `createTestModule` |
| `@forinda/kickjs-prisma` | Prisma adapter (v5/6/7) |
| `@forinda/kickjs-drizzle` | Drizzle adapter, query builder |
| `@forinda/kickjs-auth` | JWT, API key, OAuth strategies |
| `@forinda/kickjs-ws` | WebSocket with `@WsController` |
| `@forinda/kickjs-queue` | BullMQ, RabbitMQ, Kafka |
| `@forinda/kickjs-cron` | `@Cron` decorator scheduling |
| `@forinda/kickjs-mailer` | SMTP, Resend, SES |
| `@forinda/kickjs-graphql` | `@Resolver`, `@Query`, `@Mutation` |
| `@forinda/kickjs-otel` | OpenTelemetry tracing + metrics |
| `@forinda/kickjs-devtools` | Debug dashboard at `/_debug` |

## CLI

```bash
kick new my-api              # Scaffold project
kick dev                     # Vite HMR dev server
kick build                   # Production build
kick g module users          # Generate full DDD module (18 files)
kick g module users --repo prisma   # With Prisma repository
```

## Documentation

[forinda.github.io/kick-js](https://forinda.github.io/kick-js/)

## License

MIT
