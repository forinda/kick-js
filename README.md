# KickJS

A production-grade, decorator-driven Node.js framework built on Express 5 and TypeScript.

KickJS gives you the DX of NestJS — decorators, dependency injection, module system, code generators — without the weight. No RxJS, no class-transformer, no class-validator. Just TypeScript, Zod, and decorators.

## Highlights

- **Custom DI container** — constructor and property injection, no external dependency
- **Decorator-driven** — `@Controller`, `@Get`, `@Post`, `@Service`, `@Autowired`, `@Middleware`
- **Zod-native validation** — schemas double as OpenAPI documentation
- **Vite HMR** — zero-downtime hot reload in development, preserves DB/Redis/Socket connections
- **DDD generators** — `kick g module users` scaffolds entity, repository, service, use-cases, DTOs, controller
- **Auto OpenAPI** — Swagger UI and ReDoc generated from your decorators and Zod schemas
- **Pluggable** — adapters for database, auth, cache, swagger; schema parsers for Zod/Yup/Joi; query builders for Drizzle/Prisma/Sequelize
- **Extensible CLI** — register project-specific commands in `kick.config.ts`
- **ESM + TypeScript strict** — modern stack, tree-shakeable packages

## Install the CLI

```bash
# Global install (recommended)
pnpm add -g @forinda/kickjs-cli

# Or use npx without installing
npx @forinda/kickjs-cli new my-api
```

### For contributors (link local build)

```bash
git clone https://github.com/forinda/kick-js.git
cd kick-js
pnpm install && pnpm build
cd packages/cli && pnpm link --global
```

Now `kick` uses your local build. After changes, just `pnpm build` — no re-link needed.

## Quick Start

```bash
# Scaffold a new project (interactive prompts for PM, git, install)
kick new my-api

# Or scaffold in the current directory
kick new .

# Start development with HMR
kick dev

# Generate a DDD module
kick g module users
```

## Minimal Example

```typescript
// src/index.ts
import 'reflect-metadata'
import { bootstrap } from '@forinda/kickjs-http'
import { UserModule } from './modules/users'

bootstrap({ modules: [UserModule] })
```

```typescript
// src/modules/users/presentation/user.controller.ts
import { Controller, Get, Post, Autowired } from '@forinda/kickjs-core'
import { RequestContext } from '@forinda/kickjs-http'
import { z } from 'zod'

const createUserSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
})

@Controller()
export class UserController {
  @Autowired() private userService!: UserService

  @Get('/')
  async list(ctx: RequestContext) {
    ctx.json(await this.userService.findAll())
  }

  @Post('/', { body: createUserSchema })
  async create(ctx: RequestContext) {
    const user = await this.userService.create(ctx.body)
    ctx.created(user)
  }
}
```

```typescript
// src/modules/users/index.ts
import { Container, type AppModule, type ModuleRoutes } from '@forinda/kickjs-core'
import { buildRoutes } from '@forinda/kickjs-http'
import { UserController } from './presentation/user.controller'
import './domain/services/user.service'

export class UserModule implements AppModule {
  register(container: Container): void {
    // Bind interfaces to implementations
  }

  routes(): ModuleRoutes {
    return {
      path: '/users',
      router: buildRoutes(UserController),
      controller: UserController, // enables auto OpenAPI docs
    }
  }
}
```

## Packages

| Package | npm | Description |
|---------|-----|-------------|
| [`@forinda/kickjs-core`](packages/core/) | [![npm](https://img.shields.io/npm/v/@forinda/kickjs-core)](https://www.npmjs.com/package/@forinda/kickjs-core) | DI container, 20+ decorators, module system, logger, error types |
| [`@forinda/kickjs-http`](packages/http/) | [![npm](https://img.shields.io/npm/v/@forinda/kickjs-http)](https://www.npmjs.com/package/@forinda/kickjs-http) | Express 5 app, router builder, RequestContext, middleware, query parsing |
| [`@forinda/kickjs-config`](packages/config/) | [![npm](https://img.shields.io/npm/v/@forinda/kickjs-config)](https://www.npmjs.com/package/@forinda/kickjs-config) | Zod-based env validation, ConfigService, `@Value` decorator |
| [`@forinda/kickjs-swagger`](packages/swagger/) | [![npm](https://img.shields.io/npm/v/@forinda/kickjs-swagger)](https://www.npmjs.com/package/@forinda/kickjs-swagger) | OpenAPI spec from decorators, Swagger UI, ReDoc, pluggable schema parsers |
| [`@forinda/kickjs-cli`](packages/cli/) | [![npm](https://img.shields.io/npm/v/@forinda/kickjs-cli)](https://www.npmjs.com/package/@forinda/kickjs-cli) | Project scaffolding, DDD code generators, custom commands |
| [`@forinda/kickjs-testing`](packages/testing/) | [![npm](https://img.shields.io/npm/v/@forinda/kickjs-testing)](https://www.npmjs.com/package/@forinda/kickjs-testing) | `createTestApp`, `createTestModule` test utilities |

## Bundle Sizes

All packages ship minified ESM with no sourcemaps. External dependencies (Express, Zod, Pino, etc.) are never bundled — only framework code is included.

| Package | JS Bundle | Description |
|---------|-----------|-------------|
| `@forinda/kickjs-core` | **13.9 kB** | DI container, decorators, module system, logger |
| `@forinda/kickjs-http` | **22.7 kB** | Express 5 app, routing, middleware, query parsing |
| `@forinda/kickjs-config` | **2.6 kB** | Zod-based env validation, ConfigService |
| `@forinda/kickjs-swagger` | **9.2 kB** | OpenAPI spec generation, Swagger UI, ReDoc |
| `@forinda/kickjs-cli` | **173.2 kB** | Project scaffolding, DDD generators (includes templates) |
| `@forinda/kickjs-testing` | **0.7 kB** | `createTestApp`, `createTestModule` helpers |
| `@forinda/kickjs-auth` | **8.0 kB** | JWT/API key strategies, auth guards |
| `@forinda/kickjs-prisma` | **2.1 kB** | Prisma adapter, DI integration |
| `@forinda/kickjs-drizzle` | **4.1 kB** | Drizzle adapter, query builder |
| `@forinda/kickjs-ws` | **6.3 kB** | WebSocket adapter with decorators |
| `@forinda/kickjs-queue` | **8.0 kB** | BullMQ/AMQP/Kafka job processing |
| `@forinda/kickjs-graphql` | **4.4 kB** | GraphQL adapter |
| `@forinda/kickjs-mailer` | **4.3 kB** | Pluggable email transports |
| `@forinda/kickjs-cron` | **3.4 kB** | Scheduled task runner |
| `@forinda/kickjs-otel` | **2.6 kB** | OpenTelemetry tracing/metrics |
| `@forinda/kickjs-devtools` | **6.0 kB** | Dev dashboard adapter |
| `@forinda/kickjs-notifications` | **2.9 kB** | Notification channels |
| `@forinda/kickjs-multi-tenant` | **1.4 kB** | Multi-tenancy middleware |

> **Total framework JS:** ~276 kB minified (core + http + config + swagger). A typical app using core, http, config, and swagger ships under 50 kB of framework code — the rest is your application logic.

## Full-Featured Bootstrap

```typescript
import 'reflect-metadata'
import express from 'express'
import helmet from 'helmet'
import cors from 'cors'
import compression from 'compression'
import { bootstrap, requestId } from '@forinda/kickjs-http'
import { SwaggerAdapter } from '@forinda/kickjs-swagger'
import { modules } from './modules'

bootstrap({
  modules,
  apiPrefix: '/api',
  defaultVersion: 1,
  trustProxy: true,

  adapters: [
    new HealthAdapter(),
    new DatabaseAdapter({ url: process.env.DATABASE_URL }),
    new SwaggerAdapter({
      info: { title: 'My API', version: '1.0.0' },
      bearerAuth: true,
    }),
  ],

  middleware: [
    requestId(),
    helmet(),
    cors({ origin: process.env.CORS_ORIGIN }),
    compression(),
    express.json({ limit: '1mb' }),
  ],
})
```

## Decorators

### Class Decorators

| Decorator | Purpose |
|-----------|---------|
| `@Injectable()` | Mark a class for DI registration |
| `@Service()` | Semantic alias for business logic |
| `@Repository()` | Semantic alias for data access |
| `@Controller(path?)` | HTTP controller with optional route prefix |
| `@Configuration()` | Factory class for `@Bean` methods |
| `@Component()` | Generic managed component |

### Method Decorators

| Decorator | Purpose |
|-----------|---------|
| `@Get(path?, validation?)` | HTTP GET route |
| `@Post(path?, validation?)` | HTTP POST route with optional Zod body/query/params validation |
| `@Put(path?, validation?)` | HTTP PUT route |
| `@Delete(path?, validation?)` | HTTP DELETE route |
| `@Patch(path?, validation?)` | HTTP PATCH route |
| `@Bean(options?)` | Factory method inside `@Configuration` |
| `@PostConstruct()` | Lifecycle hook called after instantiation |
| `@Transactional()` | Wrap method in DB transaction (auto commit/rollback) |
| `@Middleware(...handlers)` | Attach middleware to class or method |
| `@FileUpload(config)` | Configure file upload handling |

### Property Decorators

| Decorator | Purpose |
|-----------|---------|
| `@Autowired(token?)` | Lazy property injection from container |
| `@Inject(token)` | Constructor parameter injection with explicit token |
| `@Value(envKey, default?)` | Inject environment variable (throws if missing with no default) |

### Swagger Decorators

| Decorator | Purpose |
|-----------|---------|
| `@ApiTags(...tags)` | Tag controller or method |
| `@ApiOperation({ summary })` | Describe an endpoint |
| `@ApiResponse({ status, description, schema? })` | Document response (stackable) |
| `@ApiBearerAuth()` | Mark as requiring auth |
| `@ApiExclude()` | Hide from OpenAPI spec |

## Query String Parsing

Built-in ORM-agnostic query parser supporting filtering, sorting, pagination, and full-text search.

```typescript
@Get('/')
async list(ctx: RequestContext) {
  const parsed = ctx.qs({
    filterable: ['status', 'priority'],
    sortable: ['createdAt', 'title'],
    searchable: ['title', 'description'],
  })

  // Pass to your ORM query builder adapter
  const q = drizzleAdapter.build(parsed, { columns, searchColumns })
  const rows = await db.select().from(todos)
    .where(q.where).orderBy(...q.orderBy)
    .limit(q.limit).offset(q.offset)

  ctx.json(rows)
}
```

### Query Format

```
GET /api/v1/todos?page=2&limit=25&q=urgent&filter=status:eq:active&filter=priority:gte:3&sort=createdAt:desc
```

| Parameter | Format | Example |
|-----------|--------|---------|
| `page` | Number (default: 1) | `?page=2` |
| `limit` | Number (default: 20, max: 100) | `?limit=50` |
| `q` | Search string | `?q=hello` |
| `filter` | `field:operator:value` (repeatable) | `?filter=status:eq:active` |
| `sort` | `field:asc\|desc` (repeatable) | `?sort=name:asc` |

**Filter operators:** `eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `between`, `in`, `contains`, `starts`, `ends`

### Custom Query Builder Adapter

Implement `QueryBuilderAdapter` to translate `ParsedQuery` into your ORM's query format:

```typescript
import { type QueryBuilderAdapter, type ParsedQuery } from '@forinda/kickjs-http'

// Prisma adapter
class PrismaQueryAdapter implements QueryBuilderAdapter<PrismaQuery, PrismaConfig> {
  name = 'prisma'
  build(parsed: ParsedQuery, config: PrismaConfig): PrismaQuery {
    return {
      where: buildPrismaWhere(parsed.filters, config.fieldMap),
      orderBy: parsed.sort.map(s => ({ [s.field]: s.direction })),
      skip: parsed.pagination.offset,
      take: parsed.pagination.limit,
    }
  }
}

// Sequelize adapter
class SequelizeQueryAdapter implements QueryBuilderAdapter<SequelizeQuery, SequelizeConfig> {
  name = 'sequelize'
  build(parsed: ParsedQuery, config: SequelizeConfig): SequelizeQuery {
    return {
      where: buildSequelizeWhere(parsed.filters, config.columns),
      order: parsed.sort.map(s => [s.field, s.direction.toUpperCase()]),
      offset: parsed.pagination.offset,
      limit: parsed.pagination.limit,
    }
  }
}

// Drizzle adapter
class DrizzleQueryAdapter implements QueryBuilderAdapter<DrizzleQuery, DrizzleConfig> {
  name = 'drizzle'
  build(parsed: ParsedQuery, config: DrizzleConfig): DrizzleQuery {
    return {
      where: buildDrizzleWhere(parsed.filters, config.columns),
      orderBy: buildDrizzleSort(parsed.sort, config.columns),
      limit: parsed.pagination.limit,
      offset: parsed.pagination.offset,
    }
  }
}
```

## Pluggable Schema Parser (Swagger)

Swagger uses Zod by default to convert validation schemas into OpenAPI JSON Schema. Override for Yup, Joi, Valibot, ArkType, or any other validation library:

```typescript
import Joi from 'joi'
import joiToJson from 'joi-to-json'
import { type SchemaParser, SwaggerAdapter } from '@forinda/kickjs-swagger'

const joiParser: SchemaParser = {
  name: 'joi',
  supports: (schema) => Joi.isSchema(schema),
  toJsonSchema: (schema) => joiToJson(schema),
}

new SwaggerAdapter({
  info: { title: 'My API', version: '1.0.0' },
  schemaParser: joiParser,
})
```

## Adapter Pattern

Adapters hook into the application lifecycle to add functionality like database connections, auth, caching, or documentation.

```typescript
import { type AppAdapter, type Container } from '@forinda/kickjs-core'
import type { Express } from 'express'

export class RedisAdapter implements AppAdapter {
  name = 'RedisAdapter'

  beforeMount(app: Express, container: Container) {
    container.registerInstance(REDIS, redisClient)
  }

  middleware() {
    return [{ handler: rateLimiter(), phase: 'afterGlobal' as const }]
  }

  async shutdown() {
    await redisClient.quit()
  }
}
```

**Lifecycle hooks:** `beforeMount` > `middleware` (4 phases) > `beforeStart` > `afterStart` > `shutdown`

**Middleware phases:** `beforeGlobal` > user middleware > `afterGlobal` > module registration > `beforeRoutes` > routes > `afterRoutes`

## Module System

Modules encapsulate a feature domain. Each module registers its dependencies and declares its routes.

```typescript
export class OrderModule implements AppModule {
  register(container: Container): void {
    container.registerFactory(ORDER_REPOSITORY, () =>
      container.resolve(DrizzleOrderRepository),
    )
  }

  routes(): ModuleRoutes {
    return {
      path: '/orders',
      version: 2,  // mounts at /api/v2/orders
      router: buildRoutes(OrderController),
      controller: OrderController,
    }
  }
}
```

## DDD Module Structure

Generated by `kick g module <name>`:

```
src/modules/<name>/
  presentation/
    <name>.controller.ts
  domain/
    entities/<name>.entity.ts
    value-objects/<name>-id.vo.ts
    repositories/<name>.repository.ts     # interface + DI token
    services/<name>-domain.service.ts
  application/
    use-cases/
      create-<name>.use-case.ts
      list-<names>.use-case.ts
      get-<name>.use-case.ts
      update-<name>.use-case.ts
      delete-<name>.use-case.ts
    dtos/
      create-<name>.dto.ts
      update-<name>.dto.ts
  infrastructure/
    repositories/
      in-memory-<name>.repository.ts
  index.ts                                # module definition
```

## CLI Commands

```bash
# Project lifecycle
kick new <project-name>     # Scaffold new project
kick dev                    # Dev server with Vite HMR
kick build                  # Production build via Vite
kick start                  # Run production build
kick info                   # Print versions and environment

# Code generation
kick g module <name>        # Full DDD module scaffold
kick g controller <name>    # Single controller
kick g service <name>       # Service class
kick g middleware <name>    # Middleware handler
kick g guard <name>         # Auth guard
kick g adapter <name>       # Lifecycle adapter
kick g dto <name>           # DTO with Zod schema
```

### Generator Flags

```bash
kick g module users --no-entity       # Skip entity/value objects
kick g module users --no-tests        # Skip test files
kick g module users --minimal         # Only index.ts + controller
kick g module users --dry-run         # Preview without writing
kick g module users --repo prisma     # Prisma repository (working code)
kick g module users --repo drizzle    # Drizzle repository (working code)
kick g module users --no-pluralize    # Singular: src/modules/user/
```

### Configuration

Configure module generation, custom commands, and more in `kick.config.ts`:

```typescript
import { defineConfig } from '@forinda/kickjs-cli'

export default defineConfig({
  pattern: 'ddd',

  // Module generation settings
  modules: {
    dir: 'src/modules',
    repo: 'prisma',                    // 'drizzle' | 'inmemory' | 'prisma' | { name: 'custom' }
    pluralize: true,                   // false → singular folder/route names
    schemaDir: 'prisma/',
  },

  // Custom CLI commands — the whole team uses kick db:migrate etc.
  commands: [
    {
      name: 'db:migrate',
      description: 'Run database migrations',
      steps: 'npx prisma migrate dev',
    },
    {
      name: 'db:seed',
      description: 'Seed the database',
      steps: 'npx prisma db seed',
    },
  ],
})
```

## Environment Configuration

```typescript
import { defineEnv, loadEnv } from '@forinda/kickjs-config'
import { z } from 'zod'

const envSchema = defineEnv((base) =>
  base.extend({
    DATABASE_URL: z.string().url(),
    JWT_SECRET: z.string().min(32),
    REDIS_URL: z.string().url().optional(),
  }),
)

// Validates on first call — throws with clear errors on misconfiguration
const env = loadEnv(envSchema)
```

## Testing

```typescript
import { createTestApp, createTestModule } from '@forinda/kickjs-testing'
import { describe, it, expect } from 'vitest'
import supertest from 'supertest'

describe('TodoController', () => {
  it('creates a todo', async () => {
    const { expressApp } = createTestApp({
      modules: [TodoModule],
      overrides: {
        [TODO_REPOSITORY]: new InMemoryTodoRepository(),
      },
    })

    const res = await supertest(expressApp)
      .post('/api/v1/todos')
      .send({ title: 'Write tests' })

    expect(res.status).toBe(201)
    expect(res.body.title).toBe('Write tests')
  })
})
```

## HMR Architecture

`kick dev` uses `vite-node --watch` for true hot module replacement:

```
File change detected
      |
import.meta.hot.accept()
      |
main() re-executes
      |
g.__app exists? --- YES -> app.rebuild()
                 \-- NO  -> app.start()
      |
rebuild():
  1. Reset DI container (fresh singletons)
  2. Create new Express app
  3. Re-run setup (middleware + routes)
  4. Swap handler on existing http.Server
      |
Preserved: HTTP server, DB pool, Redis, Socket.IO, port binding
```

## Repository Structure

```
kick-js/
  packages/
    core/           @forinda/kickjs-core
    http/           @forinda/kickjs-http
    config/         @forinda/kickjs-config
    swagger/        @forinda/kickjs-swagger
    cli/            @forinda/kickjs-cli
    testing/        @forinda/kickjs-testing
  examples/
    jira-drizzle-api/   Full Jira clone (PostgreSQL + Drizzle)
    jira-mongoose-api/  Full Jira clone (MongoDB + Mongoose)
    minimal-api/        Simplest possible app
    joi-api/            Joi schema parser for Swagger
    graphql-api/        GraphQL with resolvers
    devtools-api/       DevTools + reactive state
    microservice-api/   Microservice template
    otel-api/           OpenTelemetry tracing
  turbo.json
  pnpm-workspace.yaml
  tsconfig.base.json
```

## Dependency Graph

```
@forinda/kickjs-testing --> @forinda/kickjs-http --> @forinda/kickjs-core
                                         ^
@forinda/kickjs-config --------------------------+
@forinda/kickjs-swagger --> @forinda/kickjs-core

@forinda/kickjs-cli (standalone -- generates code, no runtime dependency)
```

## Technical Decisions

| Area | Choice | Why |
|------|--------|-----|
| DI | Custom container | Lightweight, no external dep, full control |
| Module system | ESM only | Tree-shaking, native Node.js support |
| Runtime | Node.js 20+ | LTS with native ESM |
| HTTP | Express 5 | Mature, async middleware, wide ecosystem |
| Validation | Zod | Runtime + static types, doubles as OpenAPI schema |
| Build | tsup + Vite | Fast package builds, native HMR for apps |
| Test | Vitest | ESM-native, fast, Vite-compatible |
| Logging | Pino | Fastest Node.js logger, structured JSON in prod |
| Monorepo | pnpm + Turborepo | Efficient deps, build caching |

## Roadmap

Key upcoming packages:

- **`@forinda/kickjs-database`** -- Drizzle adapter, transaction propagation, query builder adapter
- **`@forinda/kickjs-auth`** -- JWT/API key strategies, `@Authenticated`, `@Roles` guards
- **`@forinda/kickjs-cache`** -- `@Cacheable`/`@CacheEvict` with Redis or in-memory stores
- **`@forinda/kickjs-websocket`** -- Socket.IO with `@Gateway`/`@OnEvent` decorators
- **`@forinda/kickjs-queue`** -- BullMQ job processing with `@Worker` decorator
- **`@forinda/kickjs-mail`** -- Pluggable transports (Resend, SMTP), EJS templates
- **Plugin system** -- Third-party packages extend framework with adapters, CLI generators, Vite plugins

## Contributing

```bash
git clone https://github.com/forinda/kick-js.git
cd kick-js
pnpm install
pnpm build
pnpm test
```

## License

MIT License - see [LICENSE](LICENSE) for details.
