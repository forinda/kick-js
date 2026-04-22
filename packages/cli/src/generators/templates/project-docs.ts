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

> **This file is the canonical agent reference for the project.** It covers
> conventions, commands, decorators, the request lifecycle, and project
> structure. Other agent-tool files (\`AGENTS.md\`, \`GEMINI.md\`, \`.copilot.md\`,
> etc.) point back here for the full picture and only carry tool-specific
> addenda. Treat anything in this file as authoritative when the two disagree.

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

Modules implement \`AppModule\` and wire controllers via \`buildRoutes()\`.

> **Naming matters.** Module files **must** be named \`<name>.module.ts\` and live under \`src/modules/\`. The Vite plugin auto-discovers files matching \`*.module.[tj]sx?\` for HMR — a misnamed file (e.g., \`projects.ts\`) won't trigger a graceful module rebuild on save and will require a full server restart. The CLI generator (\`kick g module <name>\`) follows this convention automatically.

\`\`\`ts
// src/modules/users/users.module.ts   (named <feature>.module.ts)
import { type AppModule, type ModuleRoutes, buildRoutes } from '@forinda/kickjs'
import { UserController } from './user.controller'

export class UserModule implements AppModule {
  routes(): ModuleRoutes {
    return {
      path: '/users',
      router: buildRoutes(UserController),
      controller: UserController,
    }
  }
}
\`\`\`

Register all modules in \`src/modules/index.ts\`:

\`\`\`ts
import type { AppModuleClass } from '@forinda/kickjs'
import { UserModule } from './user/user.module'

export const modules: AppModuleClass[] = [UserModule]
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

> **Context decorators** — when a middleware's only job is to populate \`ctx.set/get\` for the handler to read, prefer \`defineContextDecorator()\` over \`@Middleware()\`. Typed via \`ContextMeta\`, supports \`dependsOn\` ordering, validates the pipeline at boot. Full pattern reference in \`AGENTS.md\` and at <https://forinda.github.io/kick-js/guide/context-decorators>.

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

### Standalone Env Utilities (No DI Required)

These functions work anywhere — scripts, CLI tools, plain files, outside \`@Service\`/\`@Controller\`:

\`\`\`ts
import { defineEnv, loadEnv, getEnv, reloadEnv, resetEnvCache, baseEnvSchema } from '@forinda/kickjs/config'
import { z } from 'zod'

// Define and parse schema
const schema = defineEnv((base) =>
  base.extend({ DATABASE_URL: z.string().url() })
)
const env = loadEnv(schema)      // Parse + validate process.env
console.log(env.PORT)            // 3000 (coerced to number)
console.log(env.DATABASE_URL)    // validated URL string

// Get single value
const port = getEnv('PORT')      // typed after kick typegen

// Reload after .env changes (HMR calls this automatically)
reloadEnv()

// Reset cache in tests that swap schemas
resetEnvCache()
\`\`\`

| Function | Purpose |
|----------|---------|
| \`defineEnv(fn)\` | Extend base schema with custom Zod keys |
| \`loadEnv(schema?)\` | Parse \`process.env\`, validate, cache, return typed object |
| \`getEnv(key, schema?)\` | Get single validated env value |
| \`reloadEnv()\` | Re-read \`.env\` from disk, re-parse with same schema |
| \`resetEnvCache()\` | Clear parsed cache AND registered schema (for tests) |
| \`baseEnvSchema\` | Base Zod schema: \`PORT\`, \`NODE_ENV\`, \`LOG_LEVEL\` |

## Standalone Utilities (No DI Required)

These utilities work outside decorated classes:

### Logger

\`\`\`ts
import { Logger, createLogger } from '@forinda/kickjs'

const log = Logger.for('MyScript')    // Static factory
log.info('Processing started')
log.error('Something failed')

const log2 = createLogger('Worker')   // Function form
\`\`\`

### Injection Tokens

\`\`\`ts
import { createToken } from '@forinda/kickjs'

// Type-safe DI tokens for factory/interface binding
const DB_URL = createToken<string>('config.database.url')
const FEATURE_FLAGS = createToken<FeatureFlags>('app.features')
\`\`\`

### Reactivity

\`\`\`ts
import { ref, computed, watch, reactive } from '@forinda/kickjs'

const count = ref(0)
const doubled = computed(() => count.value * 2)
const stop = watch(() => count.value, (val) => console.log(val))
count.value++  // logs 1
\`\`\`

### HTTP Errors

\`\`\`ts
import { HttpException, HttpStatus } from '@forinda/kickjs'

throw new HttpException(HttpStatus.NOT_FOUND, 'User not found')
\`\`\`

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

/** Generate AGENTS.md — thin pointer to CLAUDE.md (the canonical agent reference). */
export function generateAgents(name: string, _template: ProjectTemplate, pm: string): string {
  return `# AGENTS.md — ${name}

> **The canonical agent reference for this project lives in [\`CLAUDE.md\`](./CLAUDE.md).**
> Read it first. Treat anything in this file as authoritative when the two
> disagree.

This file exists so other agent tools (Codex, Gemini, Copilot CLI, etc.)
can find their bearings even if their convention is to look here. It
intentionally stays minimal — the project conventions, commands,
decorators, lifecycle, and patterns all live in \`CLAUDE.md\`.

## Quick orientation

| What | Where |
|------|-------|
| Project conventions, commands, patterns | \`CLAUDE.md\` |
| Application entry point | \`src/index.ts\` |
| Module registry | \`src/modules/index.ts\` |
| Feature modules | \`src/modules/<name>/<name>.module.ts\` |
| Env values / Zod schema | \`.env\` / \`src/config/index.ts\` |
| CLI config | \`kick.config.ts\` |

## Two non-negotiables

1. **Module file naming.** Every module file under \`src/modules/\` **must**
   be named \`<name>.module.ts\` (or \`.tsx\`/\`.js\`/\`.jsx\`). The Vite plugin
   auto-discovers \`*.module.[tj]sx?\` for HMR — a misnamed file silently
   degrades saves to a full server restart. The generator (\`kick g module\`)
   follows this convention; manual files must too.

2. **Use the project's package manager.** This project uses \`${pm}\`. Don't
   mix npm / yarn / pnpm — they produce incompatible lockfiles and the
   pre-commit hook will reject mixed installs.

## Bootstrapping

\`\`\`bash
${pm} install
${pm} run dev          # kick dev — Vite HMR
${pm} run test         # vitest run
${pm} run typecheck    # tsc --noEmit
\`\`\`

## Where to go next

- \`CLAUDE.md\` — full project guide (decorators, lifecycle, request context,
  generators, common pitfalls, package-manager conventions, etc.)
- [KickJS docs](https://forinda.github.io/kick-js/) — framework reference
- [Decorators guide](https://forinda.github.io/kick-js/guide/decorators.html)
- [Context Decorators](https://forinda.github.io/kick-js/guide/context-decorators.html) — typed pre-handler ctx-extension primitive
- [DI system](https://forinda.github.io/kick-js/guide/dependency-injection.html)
- [Testing](https://forinda.github.io/kick-js/api/testing.html)
`
}
