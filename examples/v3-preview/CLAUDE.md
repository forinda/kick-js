# CLAUDE.md — v3-preview Development Guide

## Project Overview

This is a **REST API** application built with [KickJS](https://forinda.github.io/kick-js/) — a decorator-driven Node.js framework on Express 5 and TypeScript.

## Quick Commands

```bash
pnpm install           # Install dependencies
kick dev                # Start dev server with HMR
kick build              # Production build via Vite
kick start              # Run production build
pnpm run test          # Run tests with Vitest
pnpm run typecheck     # TypeScript type checking
pnpm run format        # Format code with Prettier
```

## Project Structure

```
src/
├── index.ts           # Application bootstrap
├── modules/           # Feature modules (DDD/CQRS pattern)
│   └── index.ts       # Module registry
└── ...
```

## Package Manager

- Always use **pnpm** for this project
- Run `pnpm install` to sync dependencies
- Never mix package managers (npm/yarn/pnpm)

## Code Style

- **Prettier** — no semicolons, single quotes, trailing commas, 100 char width
- **TypeScript strict mode** — all types required
- Format before committing: `pnpm run format`
- Type check with: `pnpm run typecheck`

## Key Patterns

### Controllers

Use decorators to define routes. Annotate `ctx` with `Ctx<KickRoutes.X['method']>`
to get fully-typed `ctx.params`, `ctx.body`, and `ctx.query` from the
generated `KickRoutes` namespace (refreshed on `kick dev` and `kick typegen`).

```ts
import { Controller, Get, Post, type Ctx } from '@forinda/kickjs'

@Controller('/users')
export class UserController {
  @Get('/')
  async findAll(ctx: Ctx<KickRoutes.UserController['findAll']>) {
    return ctx.json({ users: [] })
  }

  @Post('/')
  async create(ctx: Ctx<KickRoutes.UserController['create']>) {
    const data = ctx.body
    return ctx.created({ user: data })
  }
}
```

### Services

Inject dependencies with `@Service()` and `@Autowired()`:

```ts
import { Service, Autowired } from '@forinda/kickjs'

@Service()
export class UserService {
  @Autowired()
  private userRepository!: UserRepository

  async findAll() {
    return this.userRepository.findAll()
  }
}
```

### Modules

Register controllers and providers in modules:

```ts
import { Module } from '@forinda/kickjs'
import { UserController } from './user.controller'
import { UserService } from './user.service'

@Module({
  controllers: [UserController],
  providers: [UserService],
})
export class UserModule {}
```

### RequestContext

Every controller method receives a `ctx` (alias `Ctx<TRoute>` or the
loose `RequestContext`):

```ts
ctx.body           // Request body (parsed JSON)
ctx.params         // Route params
ctx.query          // Query string
ctx.headers        // Request headers
ctx.requestId      // Auto-generated request ID
ctx.session        // Session data (if session middleware enabled)
ctx.file           // Uploaded file (single)
ctx.files          // Uploaded files (multiple)

// Pagination helpers
ctx.qs(config)           // Parse query with filters/sort/pagination
ctx.paginate(handler)     // Auto-paginated response

// Response helpers
ctx.json(data)            // 200 OK with JSON
ctx.created(data)         // 201 Created
ctx.noContent()           // 204 No Content
ctx.notFound()            // 404 Not Found
ctx.badRequest(msg)       // 400 Bad Request
```

## CLI Generators

Generate code with the `kick` CLI:

```bash
kick g module <name>              # Full module (controller, service, DTOs, repo)
kick g scaffold <name> <fields>   # CRUD module from field definitions
kick g controller <name>          # Standalone controller
kick g service <name>             # Service class
kick g middleware <name>          # Express middleware
kick g guard <name>               # Route guard (auth, roles)
kick g adapter <name>             # AppAdapter with lifecycle hooks
kick g dto <name>                 # Zod DTO schema
```

## Adding Packages

```bash
kick add auth          # JWT, API key, OAuth strategies
kick add swagger       # OpenAPI docs from decorators
kick add ws            # WebSocket support
kick add queue         # Background jobs (BullMQ/RabbitMQ/Kafka)
kick add mailer        # Email (SMTP, Resend, SES)
kick add cron          # Scheduled tasks
kick add prisma        # Prisma ORM adapter
kick add drizzle       # Drizzle ORM adapter
kick add otel          # OpenTelemetry tracing
kick add --list        # Show all available packages
```

## Environment Configuration

Edit `.env` for environment variables. Access them with `@Value()` decorator:

```ts
import { Value } from '@forinda/kickjs-config'

@Service()
export class ApiService {
  @Value('API_KEY')
  private apiKey!: string

  @Value('PORT', 3000)  // With default
  private port!: number
}
```

Or use `ConfigService`:

```ts
import { ConfigService } from '@forinda/kickjs-config'

@Service()
export class AppService {
  @Autowired()
  private config!: ConfigService

  getPort() {
    return this.config.get('PORT', 3000)
  }
}
```

## Testing

Tests live in `src/**/*.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { Container } from '@forinda/kickjs'
import { createTestApp } from '@forinda/kickjs-testing'

describe('UserController', () => {
  beforeEach(() => Container.reset())

  it('should return users', async () => {
    const app = await createTestApp([UserModule])
    const res = await app.get('/users')
    expect(res.status).toBe(200)
  })
})
```

Run tests:
- `pnpm run test` — run all tests
- `pnpm run test:watch` — watch mode

## Decorators Reference

### Route Decorators
- `@Controller('/path')` — define controller prefix
- `@Get('/'), @Post('/'), @Put('/'), @Delete('/'), @Patch('/')` — HTTP methods
- `@Middleware(fn)` — attach middleware
- `@Public()` — skip authentication (requires @forinda/kickjs-auth)
- `@Roles('admin', 'user')` — role-based access control

### DI Decorators
- `@Module({ controllers, providers, imports })` — define module
- `@Service()` — singleton service (DI-registered)
- `@Repository()` — repository (semantic alias for @Service)
- `@Autowired()` — property injection
- `@Inject('token')` — token-based injection
- `@Value('ENV_VAR')` — inject config value

## Common Pitfalls

1. **Decorators fire at import time** — make sure to import module classes in `src/modules/index.ts`
2. **Tests need `Container.reset()`** — call in `beforeEach` to isolate DI state
3. **Always use `ctx.body`** — never `req.body` directly
4. **DI requires `reflect-metadata`** — already imported in `src/index.ts`
5. **Vite HMR requires proper cleanup** — adapters should implement `shutdown()`

## Learn More

- [KickJS Documentation](https://forinda.github.io/kick-js/)
- [API Reference](https://forinda.github.io/kick-js/api/)
- [CLI Commands](https://forinda.github.io/kick-js/guide/cli-commands.html)
- [Decorators Guide](https://forinda.github.io/kick-js/guide/decorators.html)
