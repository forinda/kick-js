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

A fresh `kick new my-api` scaffolds a complete project. Here are the files
that matter, exactly as the CLI generates them:

```ts
// src/modules/hello/hello.service.ts
import { Service } from '@forinda/kickjs'

@Service()
export class HelloService {
  greet(name: string) {
    return { message: `Hello ${name} from KickJS!`, timestamp: new Date().toISOString() }
  }

  healthCheck() {
    return { status: 'ok', uptime: process.uptime() }
  }
}
```

```ts
// src/modules/hello/hello.controller.ts
import { Controller, Get, Autowired, type Ctx } from '@forinda/kickjs'
import { HelloService } from './hello.service'

@Controller()
export class HelloController {
  @Autowired() private readonly helloService!: HelloService

  @Get('/')
  index(ctx: Ctx<KickRoutes.HelloController['index']>) {
    ctx.json(this.helloService.greet('World'))
  }

  @Get('/health')
  health(ctx: Ctx<KickRoutes.HelloController['health']>) {
    ctx.json(this.helloService.healthCheck())
  }
}
```

```ts
// src/modules/hello/hello.module.ts
import { type AppModule, type ModuleRoutes, buildRoutes } from '@forinda/kickjs'
import { HelloController } from './hello.controller'

export class HelloModule implements AppModule {
  routes(): ModuleRoutes {
    return {
      path: '/hello',
      router: buildRoutes(HelloController),
      controller: HelloController,
    }
  }
}
```

```ts
// src/modules/index.ts
import type { AppModuleClass } from '@forinda/kickjs'
import { HelloModule } from './hello/hello.module'

export const modules: AppModuleClass[] = [HelloModule]
```

```ts
// src/index.ts
import 'reflect-metadata'
import './config' // registers env schema before bootstrap
import { bootstrap } from '@forinda/kickjs'
import { modules } from './modules'

export const app = await bootstrap({ modules })
```

## What's Included

Everything you need for a production API — one import:

```typescript
import {
  // DI + Decorators
  Controller, Get, Post, Put, Delete, Patch,
  Service, Repository, Autowired, Inject, Value, Middleware,
  createToken, // typed DI tokens: createToken<T>('name')

  // Application
  bootstrap, Application, buildRoutes,
  RequestContext, type Ctx, type RouteShape,

  // Middleware
  helmet, cors, csrf, rateLimit, requestId, requestLogger,
  validate, upload, session, traceContext,

  // Query parsing
  parseQuery, type QueryFieldConfig, type ParsedQuery,

  // Utilities
  Container, HttpException, createLogger,
  ref, computed, watch,

  // Types
  type AppAdapter, type AdapterContext, type AppModule,
  type MiddlewareHandler, type ModuleRoutes,
} from '@forinda/kickjs'
```

## Typed Routes, Body, Query, and Env

`kick typegen` (auto-runs on `kick dev`) generates `KickRoutes` and `KickEnv`
from your codebase. Route handlers, request bodies, query strings, and
`@Value` injections are all type-checked end-to-end:

```ts
import { Controller, Post, Value, type Ctx } from '@forinda/kickjs'
import { z } from 'zod'

const createUserBody = z.object({ name: z.string(), email: z.string().email() })

@Controller('/users')
class UserController {
  // Typed env injection — keys come from KickEnv (your src/config/index.ts)
  @Value('DATABASE_URL') private dbUrl!: string

  @Post('/', { body: createUserBody, name: 'CreateUser' })
  create(ctx: Ctx<KickRoutes.UserController['create']>) {
    ctx.body.email // ✅ string — inferred from the Zod schema
    ctx.created({ id: '1', ...ctx.body })
  }
}
```

## Typed DI Tokens

```typescript
import { createToken, Inject, Service } from '@forinda/kickjs'

export const USER_REPO = createToken<UserRepository>('user.repo')

@Service()
class UserService {
  constructor(@Inject(USER_REPO) private readonly repo: UserRepository) {}
  // repo is typed as UserRepository — no casts
}
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
| [`@forinda/kickjs`](https://www.npmjs.com/package/@forinda/kickjs) | Core framework (DI, decorators, Express 5, middleware) |
| [`@forinda/kickjs-config`](https://www.npmjs.com/package/@forinda/kickjs-config) | Zod-based env validation, ConfigService, `@Value` |
| [`@forinda/kickjs-swagger`](https://www.npmjs.com/package/@forinda/kickjs-swagger) | Auto OpenAPI from decorators + Zod schemas |
| [`@forinda/kickjs-cli`](https://www.npmjs.com/package/@forinda/kickjs-cli) | Scaffolding, DDD generators, custom commands |
| [`@forinda/kickjs-testing`](https://www.npmjs.com/package/@forinda/kickjs-testing) | `createTestApp`, `createTestModule` |
| [`@forinda/kickjs-prisma`](https://www.npmjs.com/package/@forinda/kickjs-prisma) | Prisma adapter (v5/6/7) |
| [`@forinda/kickjs-drizzle`](https://www.npmjs.com/package/@forinda/kickjs-drizzle) | Drizzle adapter, query builder |
| [`@forinda/kickjs-auth`](https://www.npmjs.com/package/@forinda/kickjs-auth) | JWT, API key, OAuth strategies |
| [`@forinda/kickjs-ws`](https://www.npmjs.com/package/@forinda/kickjs-ws) | WebSocket with `@WsController` |
| [`@forinda/kickjs-queue`](https://www.npmjs.com/package/@forinda/kickjs-queue) | BullMQ, RabbitMQ, Kafka |
| [`@forinda/kickjs-cron`](https://www.npmjs.com/package/@forinda/kickjs-cron) | `@Cron` decorator scheduling |
| [`@forinda/kickjs-mailer`](https://www.npmjs.com/package/@forinda/kickjs-mailer) | SMTP, Resend, SES |
| [`@forinda/kickjs-graphql`](https://www.npmjs.com/package/@forinda/kickjs-graphql) | `@Resolver`, `@Query`, `@Mutation` |
| [`@forinda/kickjs-otel`](https://www.npmjs.com/package/@forinda/kickjs-otel) | OpenTelemetry tracing + metrics |
| [`@forinda/kickjs-devtools`](https://www.npmjs.com/package/@forinda/kickjs-devtools) | Debug dashboard at `/_debug` |

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
