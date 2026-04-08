type ProjectTemplate = 'rest' | 'graphql' | 'ddd' | 'cqrs' | 'minimal'

/** Generate README.md with project documentation */
export function generateReadme(name: string, template: ProjectTemplate, pm: string): string {
  const templateLabels: Record<string, string> = {
    rest: 'REST API',
    graphql: 'GraphQL API',
    ddd: 'Domain-Driven Design',
    cqrs: 'CQRS + Event-Driven',
    minimal: 'Minimal',
  }

  const packages = ['@forinda/kickjs', '@forinda/kickjs-vite']
  if (template !== 'minimal') {
    packages.push('@forinda/kickjs-swagger', '@forinda/kickjs-devtools')
  }
  if (template === 'graphql') packages.push('@forinda/kickjs-graphql')
  if (template === 'cqrs') {
    packages.push('@forinda/kickjs-queue', '@forinda/kickjs-ws', '@forinda/kickjs-otel')
  }

  return `# ${name}

A **${templateLabels[template] ?? 'REST API'}** built with [KickJS](https://forinda.github.io/kick-js/) — a decorator-driven Node.js framework on Express 5 and TypeScript.

## Getting Started

\`\`\`bash
${pm} install
kick dev
\`\`\`

## Scripts

| Command | Description |
|---|---|
| \`kick dev\` | Start dev server with Vite HMR |
| \`kick build\` | Production build |
| \`kick start\` | Run production build |
| \`${pm} run test\` | Run tests with Vitest |
| \`kick g module <name>\` | Generate a DDD module |
| \`kick g scaffold <name> <fields...>\` | Generate CRUD from field definitions |
| \`kick add <package>\` | Add a KickJS package |

## Project Structure

\`\`\`
src/
├── index.ts           # Application entry point
├── modules/           # Feature modules (controllers, services, repos)
│   └── index.ts       # Module registry
└── ...
\`\`\`

## Packages

${packages.map((p) => `- \`${p}\``).join('\n')}

## Adding Features

\`\`\`bash
kick add auth          # Authentication (JWT, API key, OAuth)
kick add swagger       # OpenAPI documentation
kick add ws            # WebSocket support
kick add queue         # Background job processing
kick add mailer        # Email sending
kick add cron          # Scheduled tasks
kick add --list        # Show all available packages
\`\`\`

## Environment Variables

Copy \`.env.example\` to \`.env\` and configure:

| Variable | Default | Description |
|---|---|---|
| \`PORT\` | \`3000\` | Server port |
| \`NODE_ENV\` | \`development\` | Environment |

## Learn More

- [KickJS Documentation](https://forinda.github.io/kick-js/)
- [CLI Reference](https://forinda.github.io/kick-js/api/cli.html)
`
}

/** Generate CLAUDE.md with AI development guide */
export function generateClaude(name: string, template: ProjectTemplate, pm: string): string {
  const templateLabels: Record<string, string> = {
    rest: 'REST API',
    graphql: 'GraphQL API',
    ddd: 'Domain-Driven Design',
    cqrs: 'CQRS + Event-Driven',
    minimal: 'Minimal Express',
  }

  return `# CLAUDE.md — ${name} Development Guide

## Project Overview

This is a **${templateLabels[template] ?? 'REST API'}** application built with [KickJS](https://forinda.github.io/kick-js/) — a decorator-driven Node.js framework on Express 5 and TypeScript.

## Quick Commands

\`\`\`bash
${pm} install           # Install dependencies
kick dev                # Start dev server with HMR
kick build              # Production build via Vite
kick start              # Run production build
${pm} run test          # Run tests with Vitest
${pm} run typecheck     # TypeScript type checking
${pm} run format        # Format code with Prettier
\`\`\`

## Project Structure

\`\`\`
src/
├── index.ts           # Application bootstrap
├── modules/           # Feature modules (DDD/CQRS pattern)
│   └── index.ts       # Module registry
${template === 'graphql' ? '├── resolvers/         # GraphQL resolvers\n' : ''}└── ...
\`\`\`

## Package Manager

- Always use **${pm}** for this project
- Run \`${pm} install\` to sync dependencies
- Never mix package managers (npm/yarn/pnpm)

## Code Style

- **Prettier** — no semicolons, single quotes, trailing commas, 100 char width
- **TypeScript strict mode** — all types required
- Format before committing: \`${pm} run format\`
- Type check with: \`${pm} run typecheck\`

## Key Patterns

### Controllers

Use decorators to define routes. Annotate \`ctx\` with \`Ctx<KickRoutes.X['method']>\`
to get fully-typed \`ctx.params\`, \`ctx.body\`, and \`ctx.query\` from the
generated \`KickRoutes\` namespace (refreshed on \`kick dev\` and \`kick typegen\`).

\`\`\`ts
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
\`\`\`

### Services

Inject dependencies with \`@Service()\` and \`@Autowired()\`:

\`\`\`ts
import { Service, Autowired } from '@forinda/kickjs'

@Service()
export class UserService {
  @Autowired()
  private userRepository!: UserRepository

  async findAll() {
    return this.userRepository.findAll()
  }
}
\`\`\`

### Modules

Register controllers and providers in modules:

\`\`\`ts
import { Module } from '@forinda/kickjs'
import { UserController } from './user.controller'
import { UserService } from './user.service'

@Module({
  controllers: [UserController],
  providers: [UserService],
})
export class UserModule {}
\`\`\`

### RequestContext

Every controller method receives a \`ctx\` (alias \`Ctx<TRoute>\` or the
loose \`RequestContext\`):

\`\`\`ts
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
\`\`\`

## CLI Generators

Generate code with the \`kick\` CLI:

\`\`\`bash
kick g module <name>              # Full module (controller, service, DTOs, repo)
kick g scaffold <name> <fields>   # CRUD module from field definitions
kick g controller <name>          # Standalone controller
kick g service <name>             # Service class
kick g middleware <name>          # Express middleware
kick g guard <name>               # Route guard (auth, roles)
kick g adapter <name>             # AppAdapter with lifecycle hooks
kick g dto <name>                 # Zod DTO schema
${template === 'graphql' ? 'kick g resolver <name>           # GraphQL resolver\n' : ''}${template === 'cqrs' ? 'kick g job <name>                # Queue job processor\n' : ''}\`\`\`

## Adding Packages

\`\`\`bash
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
\`\`\`

## Environment Configuration

The project's typed env schema lives in **\`src/config/index.ts\`** —
extend the base schema there with your application-specific keys, and
the schema is auto-registered with kickjs at module load. The companion
\`src/index.ts\` imports it as a side effect (\`import './config'\`) **before**
\`bootstrap()\` runs, so every \`@Service\`, \`@Controller\`, \`@Value\`, and
\`ConfigService\` resolution sees the validated extended values.

> **Do not delete \`import './config'\` from \`src/index.ts\`.** It is the
> registration step that wires \`ConfigService\` to your env schema.
> Without it, \`config.get('YOUR_KEY')\` returns \`undefined\` for every
> user-defined key and \`@Value('YOUR_KEY')\` only works because of a
> raw \`process.env\` fallback (Zod coercion + defaults are skipped).

Edit \`.env\` for variable values. Access them with \`@Value()\`:

\`\`\`ts
import { Value } from '@forinda/kickjs'

@Service()
export class ApiService {
  @Value('API_KEY')
  private apiKey!: string

  @Value('PORT', 3000)  // With default
  private port!: number
}
\`\`\`

Or use \`ConfigService\`:

\`\`\`ts
import { Service, Autowired, ConfigService } from '@forinda/kickjs'

@Service()
export class AppService {
  @Autowired()
  private config!: ConfigService

  getPort() {
    // typed: number, Zod-coerced from baseEnvSchema
    return this.config.get('PORT')
  }
}
\`\`\`

Hot-reload of \`.env\` changes during dev is wired up automatically via
\`envWatchPlugin()\` in \`vite.config.ts\` — edit \`.env\`, the dev server
reloads, and the next \`config.get()\` re-parses with the new values.

## Testing

Tests live in \`src/**/*.test.ts\`:

\`\`\`ts
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
\`\`\`

Run tests:
- \`${pm} run test\` — run all tests
- \`${pm} run test:watch\` — watch mode

## Decorators Reference

### Route Decorators
- \`@Controller('/path')\` — define controller prefix
- \`@Get('/'), @Post('/'), @Put('/'), @Delete('/'), @Patch('/')\` — HTTP methods
- \`@Middleware(fn)\` — attach middleware
- \`@Public()\` — skip authentication (requires @forinda/kickjs-auth)
- \`@Roles('admin', 'user')\` — role-based access control

### DI Decorators
- \`@Module({ controllers, providers, imports })\` — define module
- \`@Service()\` — singleton service (DI-registered)
- \`@Repository()\` — repository (semantic alias for @Service)
- \`@Autowired()\` — property injection
- \`@Inject('token')\` — token-based injection
- \`@Value('ENV_VAR')\` — inject config value

${
  template === 'cqrs'
    ? `### CQRS/Event Decorators
- \`@Job('job-name')\` — queue job handler
- \`@Process('queue-name')\` — queue processor
- \`@Cron('0 * * * *')\` — cron schedule
- \`@WsController('/path')\` — WebSocket controller
- \`@Subscribe('event')\` — WebSocket event handler

`
    : ''
}${
    template === 'graphql'
      ? `### GraphQL Decorators
- \`@Resolver()\` — GraphQL resolver
- \`@Query()\` — GraphQL query
- \`@Mutation()\` — GraphQL mutation
- \`@Arg('name')\` — resolver argument

`
      : ''
  }## Common Pitfalls

1. **Decorators fire at import time** — make sure to import module classes in \`src/modules/index.ts\`
2. **Tests need \`Container.reset()\`** — call in \`beforeEach\` to isolate DI state
3. **Always use \`ctx.body\`** — never \`req.body\` directly
4. **DI requires \`reflect-metadata\`** — already imported in \`src/index.ts\`
5. **Vite HMR requires proper cleanup** — adapters should implement \`shutdown()\`
6. **Never delete \`import './config'\` from \`src/index.ts\`** — that side-effect import registers the env schema with kickjs. Without it \`ConfigService.get('YOUR_KEY')\` returns \`undefined\` for every user-defined key. \`@Value('YOUR_KEY')\` *appears* to keep working but only via a raw \`process.env\` fallback (Zod coercion + schema defaults are silently skipped).

## Learn More

- [KickJS Documentation](https://forinda.github.io/kick-js/)
- [API Reference](https://forinda.github.io/kick-js/api/)
- [CLI Commands](https://forinda.github.io/kick-js/guide/cli-commands.html)
- [Decorators Guide](https://forinda.github.io/kick-js/guide/decorators.html)
`
}

/** Generate AGENTS.md with AI agent guide */
export function generateAgents(name: string, template: ProjectTemplate, pm: string): string {
  return `# AGENTS.md — AI Agent Guide for ${name}

This guide helps AI agents (Claude, Copilot, etc.) work effectively on this KickJS application.

## Before You Start

1. Read \`CLAUDE.md\` for project conventions and commands
2. Run \`${pm} install\` to install dependencies
3. Run \`kick dev\` to verify the app starts
4. Read the [KickJS documentation](https://forinda.github.io/kick-js/) for framework details

## Where to Find Things

### Application Structure

| What | Where |
|------|-------|
| Entry point | \`src/index.ts\` |
| Module registry | \`src/modules/index.ts\` |
| Feature modules | \`src/modules/<module-name>/\` |
${template === 'graphql' ? '| GraphQL resolvers | `src/resolvers/` |\n' : ''}| Env values | \`.env\` |
| Env schema (Zod) | \`src/config/index.ts\` |
| TypeScript config | \`tsconfig.json\` |
| Vite config (HMR) | \`vite.config.ts\` |
| Vitest config | \`vitest.config.ts\` |
| Prettier config | \`.prettierrc\` |
| CLI config | \`kick.config.ts\` |

### Module Pattern (${template.toUpperCase()})

Each module in \`src/modules/<name>/\` typically contains:

${
  template === 'ddd'
    ? `\`\`\`
<name>/
├── <name>.controller.ts     # HTTP routes (@Controller)
├── <name>.service.ts        # Business logic (@Service)
├── <name>.repository.ts     # Data access (@Repository)
├── <name>.dto.ts            # Request/response schemas (Zod)
├── <name>.entity.ts         # Domain entity (optional)
└── <name>.module.ts         # Module definition (@Module)
\`\`\`
`
    : template === 'cqrs'
      ? `\`\`\`
<name>/
├── commands/                # Write operations
│   ├── create-<name>.command.ts
│   └── create-<name>.handler.ts
├── queries/                 # Read operations
│   ├── get-<name>.query.ts
│   └── get-<name>.handler.ts
├── events/                  # Domain events
│   └── <name>-created.event.ts
├── <name>.controller.ts     # HTTP routes
├── <name>.repository.ts     # Data access
└── <name>.module.ts         # Module definition
\`\`\`
`
      : template === 'graphql'
        ? `\`\`\`
resolvers/
├── <name>.resolver.ts       # @Resolver, @Query, @Mutation
├── <name>.types.ts          # GraphQL type definitions
└── <name>.service.ts        # Business logic
\`\`\`
`
        : template === 'rest'
          ? `\`\`\`
<name>/
├── <name>.controller.ts     # HTTP routes (@Controller)
├── <name>.service.ts        # Business logic (@Service)
├── <name>.dto.ts            # Request/response schemas (Zod)
└── <name>.module.ts         # Module definition (@Module)
\`\`\`
`
          : `\`\`\`
src/
├── index.ts                 # Add routes here
└── ...                      # Custom structure
\`\`\`
`
}

## Checklist: Adding a Feature

### New Module (Recommended)

Use the CLI generator for consistency:

\`\`\`bash
kick g module <name>              # Generate full module
# or
kick g scaffold <name> <fields>   # Generate CRUD from fields
\`\`\`

Then:
- [ ] Review generated files in \`src/modules/<name>/\`
- [ ] Verify module is registered in \`src/modules/index.ts\`
- [ ] Update DTOs in \`<name>.dto.ts\` if needed
- [ ] Implement business logic in \`<name>.service.ts\`
- [ ] Run \`kick dev\` to test with HMR
- [ ] Write tests in \`<name>.test.ts\`

### Manual Controller

If not using generators:

- [ ] Create \`src/modules/<name>/<name>.controller.ts\`
- [ ] Add \`@Controller('/path')\` decorator
- [ ] Add route handlers with \`@Get()\`, \`@Post()\`, etc.
- [ ] Create module file with \`@Module({ controllers: [NameController] })\`
- [ ] Register module in \`src/modules/index.ts\`
- [ ] Test with \`kick dev\`

### Manual Service

- [ ] Create \`src/modules/<name>/<name>.service.ts\`
- [ ] Add \`@Service()\` decorator
- [ ] Inject dependencies with \`@Autowired()\`
- [ ] Register in module \`providers\` array
- [ ] Write unit tests

### New Middleware

- [ ] Create \`src/middleware/<name>.middleware.ts\`
- [ ] Export middleware function (Express format)
- [ ] Register in \`src/index.ts\` or attach to routes with \`@Middleware()\`
- [ ] Test with sample requests

### Adding a Package

Use \`kick add\` to install KickJS packages with correct peer dependencies:

- [ ] Run \`kick add <package>\` (e.g., \`kick add auth\`)
- [ ] Follow package-specific setup in terminal output
- [ ] Update \`src/index.ts\` to register adapter (if needed)
- [ ] Configure environment variables in \`.env\`
- [ ] Test integration with \`kick dev\`

## Common Tasks

### Generate CRUD Module

\`\`\`bash
kick g scaffold user name:string email:string age:number
\`\`\`

This creates a full CRUD module with:
- Controller with GET, POST, PUT, DELETE routes
- Service with business logic
- Repository with data access
- DTOs with Zod validation

### Add Authentication

\`\`\`bash
kick add auth
\`\`\`

Then configure in \`src/index.ts\`:

\`\`\`ts
import { AuthAdapter, JwtStrategy } from '@forinda/kickjs-auth'

bootstrap({
  modules,
  adapters: [
    new AuthAdapter({
      strategies: [new JwtStrategy({ secret: process.env.JWT_SECRET! })],
    }),
  ],
})
\`\`\`

### Add Database (Prisma)

\`\`\`bash
kick add prisma
${pm} install prisma @prisma/client
npx prisma init
# Edit prisma/schema.prisma
npx prisma migrate dev --name init
kick g module user --repo prisma
\`\`\`

### Add WebSocket Support

\`\`\`bash
kick add ws
\`\`\`

Then add adapter in \`src/index.ts\`:

\`\`\`ts
import { WsAdapter } from '@forinda/kickjs-ws'

bootstrap({
  modules,
  adapters: [new WsAdapter()],
})
\`\`\`

Create WebSocket controller:

\`\`\`bash
kick g controller chat --ws
\`\`\`

## Testing Guidelines

All tests use Vitest:

\`\`\`ts
import { describe, it, expect, beforeEach } from 'vitest'
import { Container } from '@forinda/kickjs'
import { createTestApp } from '@forinda/kickjs-testing'

describe('UserController', () => {
  beforeEach(() => {
    Container.reset()  // Important: isolate DI state
  })

  it('should return users', async () => {
    const app = await createTestApp([UserModule])
    const res = await app.get('/users')
    
    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('users')
  })
})
\`\`\`

Run tests:
- \`${pm} run test\` — run all tests once
- \`${pm} run test:watch\` — watch mode
- Individual file: \`${pm} run test src/modules/user/user.test.ts\`

## Environment Variables

Schema is declared in \`src/config/index.ts\` (extends the base
\`PORT\`/\`NODE_ENV\`/\`LOG_LEVEL\` shape via \`defineEnv\`) and registered
with kickjs at module load. \`src/index.ts\` imports it via
\`import './config'\` **before** \`bootstrap()\` so the cache is populated
in time for DI. Add new keys to the schema, drop their values into
\`.env\`, and they're typed everywhere.

Access patterns:

1. **@Value() decorator** (recommended for known-at-construction keys):
\`\`\`ts
@Value('DATABASE_URL')
private dbUrl!: string
\`\`\`

2. **ConfigService** (recommended for dynamic / method-scoped access):
\`\`\`ts
@Autowired()
private config!: ConfigService

const port = this.config.get('PORT')  // typed: number
\`\`\`

3. **Direct \`process.env\`** — avoid in app code; bypasses Zod
   coercion and the typed \`KickEnv\` registry.

> **Pitfall**: never delete \`import './config'\` from \`src/index.ts\`.
> If the schema is not registered before DI runs, \`config.get()\`
> returns \`undefined\` for user keys (the base shape only) and
> \`@Value()\` only works because of its raw \`process.env\` fallback —
> Zod coercion + schema defaults are silently skipped.

## Key Decorators

### HTTP Routes
| Decorator | Purpose |
|-----------|---------|
| \`@Controller('/path')\` | Define route prefix |
| \`@Get('/'), @Post('/')\` | HTTP method handlers |
| \`@Middleware(fn)\` | Attach middleware |
| \`@Public()\` | Skip auth (requires auth adapter) |
| \`@Roles('admin')\` | Role-based access |

### Dependency Injection
| Decorator | Purpose |
|-----------|---------|
| \`@Module({})\` | Define feature module |
| \`@Service()\` | Register singleton service |
| \`@Repository()\` | Register repository |
| \`@Autowired()\` | Property injection |
| \`@Inject('token')\` | Token-based injection |
| \`@Value('VAR')\` | Inject env variable |

${
  template === 'graphql'
    ? `### GraphQL
| Decorator | Purpose |
|-----------|---------|
| \`@Resolver()\` | GraphQL resolver class |
| \`@Query()\` | Query handler |
| \`@Mutation()\` | Mutation handler |
| \`@Arg('name')\` | Resolver argument |

`
    : ''
}${
    template === 'cqrs'
      ? `### Background Jobs
| Decorator | Purpose |
|-----------|---------|
| \`@Job('name')\` | Queue job handler |
| \`@Process('queue')\` | Queue processor |
| \`@Cron('0 * * * *')\` | Cron schedule |
| \`@WsController()\` | WebSocket controller |

`
      : ''
  }## Common Pitfalls

1. **Forgot to register module** — Add to \`src/modules/index.ts\` exports array
2. **DI not working** — Ensure \`reflect-metadata\` is imported in \`src/index.ts\`
3. **Tests failing randomly** — Missing \`Container.reset()\` in \`beforeEach\`
4. **Routes not found** — Check controller path and module registration
5. **HMR not working** — Verify \`vite.config.ts\` has \`hmr: true\`
6. **Decorators not working** — Check \`tsconfig.json\` has \`experimentalDecorators: true\`
7. **\`config.get('YOUR_KEY')\` returns \`undefined\`** — \`src/index.ts\` is missing \`import './config'\`. That side-effect import registers the env schema with kickjs (\`loadEnv(envSchema)\` runs at module load). Without it, \`ConfigService\` falls back to the base schema (\`PORT\`/\`NODE_ENV\`/\`LOG_LEVEL\` only) and every user-defined key reads as \`undefined\`. \`@Value()\` may *appear* to work because of a raw \`process.env\` fallback, but Zod coercion and schema defaults are silently skipped — investigate \`src/index.ts\` and \`src/config/index.ts\` first.

## CLI Commands Reference

| Command | Description |
|---------|-------------|
| \`kick dev\` | Dev server with HMR |
| \`kick dev:debug\` | Dev server with debugger |
| \`kick build\` | Production build |
| \`kick start\` | Run production build |
| \`kick g module <names...>\` | Generate one or more modules |
| \`kick g scaffold <name> <fields>\` | Generate CRUD |
| \`kick g controller <name>\` | Generate controller |
| \`kick g service <name>\` | Generate service |
| \`kick g middleware <name>\` | Generate middleware |
| \`kick add <package>\` | Add KickJS package |
| \`kick add --list\` | List available packages |
| \`kick rm module <names...>\` | Remove one or more modules |

> **Note:** When using \`kick new\` in scripts or CI, pass \`-t\` (or \`--template\`) and \`-r\` (or \`--repo\`) flags to bypass interactive prompts:
> \`\`\`bash
> kick new my-api -t ddd -r prisma --pm ${pm} --no-git --no-install -f
> \`\`\`

## Learn More

- [KickJS Docs](https://forinda.github.io/kick-js/)
- [CLI Reference](https://forinda.github.io/kick-js/api/cli.html)
- [Decorators Guide](https://forinda.github.io/kick-js/guide/decorators.html)
- [DI System](https://forinda.github.io/kick-js/guide/dependency-injection.html)
- [Testing](https://forinda.github.io/kick-js/api/testing.html)
`
}
