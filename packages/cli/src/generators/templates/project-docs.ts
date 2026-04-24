type ProjectTemplate = 'rest' | 'ddd' | 'cqrs' | 'minimal'

/** Generate README.md with project documentation */
export function generateReadme(name: string, template: ProjectTemplate, pm: string): string {
  const templateLabels: Record<string, string> = {
    rest: 'REST API',
    ddd: 'Domain-Driven Design',
    cqrs: 'CQRS + Event-Driven',
    minimal: 'Minimal',
  }

  const packages = ['@forinda/kickjs', '@forinda/kickjs-vite']
  if (template !== 'minimal') {
    packages.push('@forinda/kickjs-swagger', '@forinda/kickjs-devtools')
  }
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

/**
 * Generate CLAUDE.md.
 *
 * v4 update: this file is intentionally thin. AGENTS.md is the
 * canonical, multi-agent project reference (Claude / Copilot /
 * Codex / Gemini / etc.) — duplicating it here meant two files
 * drifting out of sync after every framework change. The generated
 * CLAUDE.md now redirects there + adds Claude-specific affordances
 * only.
 */
export function generateClaude(name: string, _template: ProjectTemplate, pm: string): string {
  return `# CLAUDE.md — ${name}

**Read \`./AGENTS.md\` first.** It is the canonical, multi-agent
reference for this project (Claude, Copilot, Codex, Gemini, etc.) —
project conventions, structure, decorator patterns, env wiring, CLI
generators, every gotcha.

**Then read \`./kickjs-skills.md\`.** That file is the task-oriented
skill index — short, rigid recipes keyed to triggers ("add-module",
"write-controller-test", "bootstrap-export", "deny-list", …). Use it
as the playbook when executing common KickJS workflows.

This file is a thin Claude-specific layer on top of those two; when
they disagree on anything substantive, treat \`AGENTS.md\` as
authoritative and flag the discrepancy.

## Why two files

\`AGENTS.md\` is what every agent reads. \`CLAUDE.md\` is what
Claude Code automatically loads as project context on each
conversation. Keeping CLAUDE.md slim avoids two files drifting; the
redirect above ensures Claude pulls the canonical content without
us copy-pasting.

## Claude-specific notes

- **Slash commands** — \`/help\` for Claude Code commands; \`/init\`
  to refresh project memory if AGENTS.md changes substantially.
- **Feedback** — file issues at <https://github.com/anthropics/claude-code/issues>.
- **Persistent memory** — Claude maintains user/feedback/project/
  reference memories under \`.claude/memory/\`. If you ask for
  something that contradicts a remembered preference, Claude flags
  it before acting; corrections update memory automatically.
- **Long-running tasks** — \`/loop\` and \`/schedule\` for recurring
  or background work. Useful for "wait for the deploy then open a
  cleanup PR" or "every Monday triage the issue board" patterns.

## Quick reference (full version in AGENTS.md)

\`\`\`bash
${pm} install            # Install dependencies
kick dev                 # Dev server with HMR + typegen
kick build && kick start # Production
${pm} run test           # Vitest
${pm} run typecheck      # tsc --noEmit
${pm} run format         # Prettier
\`\`\`

## v4 framework reminders

When generating or modifying code in this project, stay aligned with the v4 conventions documented in \`AGENTS.md\`:

- **Adapters**: \`defineAdapter()\` factory — never \`class implements AppAdapter\`.
- **Plugins**: \`definePlugin()\` factory — never plain function returning \`KickPlugin\`.
- **DI tokens**: slash-delimited \`<scope>/<area>/<key>\` (e.g. \`'app/users/repository'\`). First-party uses the reserved \`'kick/'\` prefix; this project owns its own scope.
- **Decorators**: \`@Controller()\` (no path arg — mount prefix comes from \`routes().path\`).
- **Module entry file** MUST be named \`<name>.module.ts\` and live under \`src/modules/<name>/\`. The Vite plugin auto-discovers \`*.module.[tj]sx?\` for graceful HMR — a misnamed \`projects.ts\` silently degrades every save into a full restart.
- **Env**: schema lives in \`src/config/index.ts\`; \`import './config'\` MUST be the first import in \`src/index.ts\` (side-effect registers the schema before any \`@Value\` resolves).
- **Assets**: drop new template files into \`src/templates/<namespace>/\`; the dev watcher auto-rebuilds the \`KickAssets\` augmentation + \`assets.x.y()\` re-walks on next call. No restart, no manual build.
- **Context Contributors** (\`defineContextDecorator\`) over \`@Middleware()\` for ctx-population work.
- **Repos under tests**: \`Container.create()\` for isolation — never \`new Container()\` or \`getInstance().reset()\`.
- **Bootstrap export**: \`src/index.ts\` must end with \`export const app = await bootstrap({ ... })\`. The Vite plugin and \`createTestApp\` import the named \`app\`; without the export, HMR silently degrades to full restarts.
- **Thin entry file**: aggregate \`modules\`, \`middleware\`, \`plugins\`, \`adapters\` in their own folders (\`src/modules/index.ts\`, \`src/middleware/index.ts\`, …) and pass them by name to \`bootstrap()\` — never inline the lists in \`src/index.ts\`.
- **Refresh these files**: \`kick g agents -f\` regenerates \`AGENTS.md\` + \`CLAUDE.md\` from the latest CLI templates. Hand-edited content is overwritten — keep customisation in \`AGENTS.local.md\`.

For everything else (controllers, services, modules, RequestContext API, generators, CLI commands, package additions, env wiring, troubleshooting) → \`AGENTS.md\`.
`
}

// Legacy reference left as a comment for the v4 doc — the original
// generator embedded ~400 lines of patterns here that duplicated
// AGENTS.md. The chunk below is the unused remnant of that template
// kept under a `false &&` guard so the diff stays reviewable; it can
// be deleted in the next minor.
function _LEGACY_FULL_CLAUDE_TEMPLATE_UNUSED(
  name: string,
  template: ProjectTemplate,
  pm: string,
): string {
  const templateLabels: Record<string, string> = {
    rest: 'REST API',
    ddd: 'Domain-Driven Design',
    cqrs: 'CQRS + Event-Driven',
    minimal: 'Minimal Express',
  }

  return `# CLAUDE.md — ${name} Development Guide

> **Read \`AGENTS.md\` first.** It is the canonical, multi-agent reference for this project (Claude, Copilot, Codex, Gemini, etc.). This file contains the same project context distilled for Claude, plus Claude-specific notes. When the two disagree on anything substantive, treat \`AGENTS.md\` as authoritative and flag the discrepancy.

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
└── ...
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

@Controller()
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
${template === 'cqrs' ? 'kick g job <name>                # Queue job processor\n' : ''}\`\`\`

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

// Type-safe DI tokens for factory/interface binding.
// Convention: '<orgScope>/<area>/<key>' — slash-delimited, lowercase.
const DB_URL = createToken<string>('app/config/database-url')
const FEATURE_FLAGS = createToken<FeatureFlags>('app/features')
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
- \`@Controller()\` — mark a class as an HTTP controller (path comes from \`routes().path\`)
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

This guide is the **canonical, multi-agent reference** for this KickJS
application — Claude, Copilot, Codex, Gemini, etc. all read it first.
Per-agent files (\`CLAUDE.md\`, \`GEMINI.md\`, etc.) are thin layers that
add tool-specific affordances on top.

## Before You Start

1. Run \`${pm} install\` to install dependencies
2. Run \`kick dev\` to verify the app starts
3. Read the [KickJS documentation](https://forinda.github.io/kick-js/) for framework details

## v4 Conventions (don't skip)

KickJS v4 made a handful of structural changes from v3. Internalise these
before generating or modifying code — they are the source of most agent
mistakes:

- **Adapters** — \`defineAdapter()\` factory. Never write \`class Foo implements AppAdapter\`.

  \`\`\`ts
  export const MyAdapter = defineAdapter<MyOptions>({
    name: 'MyAdapter',
    defaults: { ... },
    build: (config) => ({
      beforeMount({ app }) { /* ... */ },
      afterStart({ server }) { /* ... */ },
    }),
  })
  \`\`\`

- **Plugins** — \`definePlugin()\` factory. Same shape, never plain function returning \`KickPlugin\`.

- **DI tokens** — slash-delimited \`<scope>/<area>/<key>\`, lower-case, no \`:\` separators:

  \`\`\`ts
  const USERS_REPO = createToken<UsersRepo>('app/users/repository')
  const DB         = createToken<Database>('app/db/connection')
  \`\`\`

  The \`kick/\` prefix is reserved for first-party packages; this project
  owns its own scope (\`app/\`, your domain name, etc.).

- **\`@Controller()\`** takes **no path argument**. Mount prefix comes from
  the module's \`routes()\` return value, not the decorator. \`@Controller('/users')\`
  is a v3 leftover; the linter and codegen reject it.

- **Env wiring** — \`src/config/index.ts\` calls \`loadEnv(envSchema)\` as a
  side effect. \`src/index.ts\` MUST have \`import './config'\` as its **first**
  import (before \`bootstrap()\`). Without it, \`ConfigService.get('YOUR_KEY')\`
  returns \`undefined\` and \`@Value()\` only works via raw \`process.env\` fallback
  (Zod coercion + defaults silently skipped).

- **Module entry files MUST be named \`<name>.module.ts\`** — see the Vite
  HMR contract at the top of "Module Pattern" below. The CLI enforces this;
  hand-rolled files must too.

- **Assets** — drop new template files into \`src/templates/<namespace>/\`
  (or wherever \`kick.config.ts\` points). The dev watcher auto-rebuilds the
  \`KickAssets\` augmentation; \`assets.x.y()\` re-walks on next call. No restart,
  no manual build step.

- **Context over \`@Middleware()\`** — when a middleware's only job is to
  populate \`ctx.set('key', value)\`, use \`defineHttpContextDecorator()\`
  (HTTP) or \`defineContextDecorator()\` (transport-agnostic) instead.
  Typed via \`ContextMeta\`, ordered via \`dependsOn\`, validated at boot.
  Reserve \`@Middleware()\` for response short-circuit / stream mutation /
  pre-route-matching work.

  Two ground rules around the data flow — both stem from the fact that
  every per-request stage gets its OWN \`RequestContext\` instance, all
  reading/writing the SAME \`AsyncLocalStorage\`-backed Map:
  - **\`resolve\` and \`onError\` must RETURN the value.** The runner
    writes it via \`ctx.set(reg.key, value)\` on your behalf. Direct
    property assignment (\`ctx.tenant = …\`) sticks to the contributor
    instance only — the handler instance never sees it.
  - **Read across instances via \`ctx.set\` / \`ctx.get\`** (or
    \`getRequestValue(key)\` from a service that has no \`ctx\` reference
    — typed via \`MetaValue<K>\`). \`ctx.req\` works because the underlying
    Express request is shared; bespoke property assignments don't.

- **Test isolation** — default to \`Container.create()\` for fresh DI state.
  Never \`new Container()\` and never \`getInstance().reset()\` — both leak
  registrations between tests.

  \`\`\`ts
  const container = Container.create()
  // ... register test-scoped providers, run, discard
  \`\`\`

- **Bootstrap export** — \`src/index.ts\` MUST end with
  \`export const app = await bootstrap({ ... })\`. The Vite plugin imports
  the named \`app\` symbol to drive HMR module swaps; testing helpers
  (\`createTestApp\`) and the OpenAPI introspector also rely on it. Drop
  the \`export\` and \`kick dev\` will silently fall back to a full restart
  on every save while \`createTestApp\` complains about a missing handle.

- **Keep \`src/index.ts\` thin** — collect plugins, modules, middleware, and
  adapters in dedicated folders and re-export aggregated arrays. Do **not**
  inline registration in the entry file:

  \`\`\`ts
  // src/modules/index.ts
  export const modules: AppModuleClass[] = [HelloModule, UsersModule, ...]

  // src/middleware/index.ts
  export const middleware = [helmet(), cors(), requestId(), ...]

  // src/plugins/index.ts
  export const plugins = [MetricsPlugin(), AuditPlugin()]

  // src/adapters/index.ts
  export const adapters = [SwaggerAdapter({ ... }), DevToolsAdapter()]
  \`\`\`

  \`\`\`ts
  // src/index.ts — stays small; one import per category
  import 'reflect-metadata'
  import './config'
  import { bootstrap } from '@forinda/kickjs'
  import { modules } from './modules'
  import { middleware } from './middleware'
  import { plugins } from './plugins'
  import { adapters } from './adapters'

  export const app = await bootstrap({ modules, middleware, plugins, adapters })
  \`\`\`

  This keeps the entry file diff-friendly, scales to dozens of modules
  without git churn, and lets each domain own its own registration list.
  The generators (\`kick g module\`, \`kick g middleware\`, \`kick g plugin\`,
  \`kick g adapter\`) follow this layout — manual additions should too.

Everything else (controllers, services, modules, RequestContext API, generators,
package additions, env access patterns, troubleshooting) is detailed below.

## Where to Find Things

### Application Structure

| What | Where |
|------|-------|
| Entry point | \`src/index.ts\` |
| Module registry | \`src/modules/index.ts\` |
| Feature modules | \`src/modules/<module-name>/\` |
| **Module entry file** | \`src/modules/<name>/<name>.module.ts\` (filename suffix is required — see Vite HMR contract below) |
| Env values | \`.env\` |
| Env schema (Zod) | \`src/config/index.ts\` |
| TypeScript config | \`tsconfig.json\` |
| Vite config (HMR) | \`vite.config.ts\` |
| Vitest config | \`vitest.config.ts\` |
| Prettier config | \`.prettierrc\` |
| CLI config | \`kick.config.ts\` |

### Module Pattern (${template.toUpperCase()})

> **Vite HMR auto-discovery contract:** module files **must** be named \`<name>.module.ts\` (or \`.tsx\`/\`.js\`/\`.jsx\`) and live under \`src/modules/\`. The Vite plugin scans for \`*.module.[tj]sx?\` to drive graceful HMR rebuilds; renaming a file to \`projects.ts\` (no \`.module\`) silently breaks HMR — saves trigger a full restart instead of a swap. The CLI generator (\`kick g module <name>\`) follows the convention; manual files must too.

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
└── <name>.module.ts         # Module definition (implements AppModule)
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
└── <name>.module.ts         # Module definition (implements AppModule)
\`\`\`
`
      : template === 'rest'
        ? `\`\`\`
<name>/
├── <name>.controller.ts     # HTTP routes (@Controller)
├── <name>.service.ts        # Business logic (@Service)
├── <name>.dto.ts            # Request/response schemas (Zod)
└── <name>.module.ts         # Module definition (implements AppModule)
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
- [ ] Add \`@Controller()\` decorator
- [ ] Add route handlers with \`@Get()\`, \`@Post()\`, etc.
- [ ] Create module file implementing \`AppModule\` with \`routes()\` returning \`{ path, router: buildRoutes(Controller), controller }\`
- [ ] Register module in \`src/modules/index.ts\` (\`AppModuleClass[]\` array)
- [ ] Test with \`kick dev\`

### Manual Service

- [ ] Create \`src/modules/<name>/<name>.service.ts\`
- [ ] Add \`@Service()\` decorator
- [ ] Inject dependencies with \`@Autowired()\`
- [ ] Inject via \`@Autowired()\` where needed
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
kick g scaffold user name:string email:string:optional age:number
\`\`\`

Append \`:optional\` for optional fields (shell-safe, no quoting needed).
Quoted \`?\` syntax also works: \`"email:string?"\` or \`"email?:string"\`.

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
    AuthAdapter({
      strategies: [JwtStrategy({ secret: process.env.JWT_SECRET! })],
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
  adapters: [WsAdapter()],
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
  it('should return users', async () => {
    // Container.create() — isolated DI state per test, never new Container()
    // and never getInstance().reset() (both leak registrations between tests).
    const container = Container.create()
    const app = await createTestApp([UserModule], { container })
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

3. **Standalone utilities** (no DI — works in scripts, CLI, plain files):
\`\`\`ts
import { loadEnv, getEnv, reloadEnv, resetEnvCache } from '@forinda/kickjs/config'

const env = loadEnv(schema)         // Parse + validate all vars
const port = getEnv('PORT')         // Single value lookup
reloadEnv()                         // Re-read .env from disk
resetEnvCache()                     // Full reset (for tests)
\`\`\`

4. **Direct \`process.env\`** — avoid in app code; bypasses Zod
   coercion and the typed \`KickEnv\` registry.

> **Pitfall**: never delete \`import './config'\` from \`src/index.ts\`.
> If the schema is not registered before DI runs, \`config.get()\`
> returns \`undefined\` for user keys (the base shape only) and
> \`@Value()\` only works because of its raw \`process.env\` fallback —
> Zod coercion + schema defaults are silently skipped.

## Standalone Utilities (No DI Required)

These work anywhere — scripts, plain files, outside \`@Service\`/\`@Controller\`:

| Utility | Import | Example |
|---------|--------|---------|
| \`Logger.for(name)\` | \`@forinda/kickjs\` | \`const log = Logger.for('MyScript')\` |
| \`createLogger(name)\` | \`@forinda/kickjs\` | \`const log = createLogger('Worker')\` |
| \`createToken<T>(name)\` | \`@forinda/kickjs\` | \`const TOKEN = createToken<string>('app/db/url')\` |
| \`ref(value)\` | \`@forinda/kickjs\` | \`const count = ref(0)\` |
| \`computed(fn)\` | \`@forinda/kickjs\` | \`const doubled = computed(() => count.value * 2)\` |
| \`watch(source, cb)\` | \`@forinda/kickjs\` | \`watch(() => count.value, (v) => log(v))\` |
| \`reactive(obj)\` | \`@forinda/kickjs\` | \`const state = reactive({ count: 0 })\` |
| \`HttpException\` | \`@forinda/kickjs\` | \`throw new HttpException(404, 'Not found')\` |
| \`HttpStatus\` | \`@forinda/kickjs\` | \`HttpStatus.NOT_FOUND // 404\` |

## Key Decorators

### HTTP Routes
| Decorator | Purpose |
|-----------|---------|
| \`@Controller()\` | Define route prefix |
| \`@Get('/'), @Post('/')\` | HTTP method handlers |
| \`@Middleware(fn)\` | Attach middleware |
| \`@Public()\` | Skip auth (requires auth adapter) |
| \`@Roles('admin')\` | Role-based access |

### Dependency Injection
| Decorator | Purpose |
|-----------|---------|
| \`AppModule\` interface | Define feature module (implements \`routes()\`) |
| \`@Service()\` | Register singleton service |
| \`@Repository()\` | Register repository |
| \`@Autowired()\` | Property injection |
| \`@Inject('token')\` | Token-based injection |
| \`@Value('VAR')\` | Inject env variable |

### Context Decorators

Typed, ordered way to populate \`ctx.set/get\` keys before the handler runs.
Use this **instead of \`@Middleware()\`** when the middleware's only output
is a value other code reads off \`ctx\`.

| Concept | Where it lives |
|---------|----------------|
| \`defineContextDecorator({ key, deps, dependsOn, optional, onError, resolve })\` | \`@forinda/kickjs\` |
| Method/class decorator | \`@LoadX\` on a controller method/class |
| Module hook | \`AppModule.contributors?(): ContributorRegistration[]\` |
| Adapter hook | \`AppAdapter.contributors?(): ContributorRegistration[]\` |
| Global registration | \`bootstrap({ contributors: [LoadX.registration] })\` |
| Type augmentation | \`declare module '@forinda/kickjs' { interface ContextMeta { ... } }\` |

Precedence high → low: **method > class > module > adapter > global**.
Cycles and missing \`dependsOn\` keys throw at \`app.setup()\` (boot fails
fast). The \`onError\` hook is async-permitted.

Full guide: <https://forinda.github.io/kick-js/guide/context-decorators>.

${
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
3. **Tests failing randomly** — Sharing the global container between tests. Default to \`Container.create()\` per test (or per \`beforeEach\`) instead of \`new Container()\` / \`getInstance().reset()\`
4. **Routes not found** — Check controller path and module registration
5. **HMR not working** — Two checks: (a) \`vite.config.ts\` has \`hmr: true\`; (b) module file is named \`<name>.module.ts\` (or \`.tsx\`/\`.js\`/\`.jsx\`) and lives under \`src/modules/\`. The Vite plugin auto-discovers \`*.module.[tj]sx?\` for graceful HMR — a misnamed module file (e.g., \`projects.ts\`) silently degrades to a full restart on every save.
6. **Decorators not working** — Check \`tsconfig.json\` has \`experimentalDecorators: true\`
7. **\`config.get('YOUR_KEY')\` returns \`undefined\`** — \`src/index.ts\` is missing \`import './config'\`. That side-effect import registers the env schema with kickjs (\`loadEnv(envSchema)\` runs at module load). Without it, \`ConfigService\` falls back to the base schema (\`PORT\`/\`NODE_ENV\`/\`LOG_LEVEL\` only) and every user-defined key reads as \`undefined\`. \`@Value()\` may *appear* to work because of a raw \`process.env\` fallback, but Zod coercion and schema defaults are silently skipped — investigate \`src/index.ts\` and \`src/config/index.ts\` first.
8. **Used \`@Middleware()\` to compute a value for \`ctx\`** — prefer \`defineContextDecorator()\` (see Context Decorators above). It's typed via \`ContextMeta\`, supports \`dependsOn\` for ordering, and validates the pipeline at boot. \`@Middleware()\` is for response short-circuiting, stream mutation, and pre-route-matching work.
9. **Context contributor's \`dependsOn\` key not produced anywhere** — boot throws \`MissingContributorError\` naming the dependent and the route. Either remove the dep or register a contributor that produces the key (at any precedence level: method/class/module/adapter/global).
10. **\`bootstrap()\` not exported** — \`src/index.ts\` calls \`await bootstrap({ ... })\` but discards the return value (no \`export const app = ...\`). Vite HMR can't locate the running instance, so module saves degrade to full restarts; \`createTestApp\`/\`@forinda/kickjs-testing\` consumers can't import the handle either. Always: \`export const app = await bootstrap({ ... })\`.
11. **Refresh AGENTS.md / CLAUDE.md after a framework upgrade** — these files are scaffolded by the CLI and don't auto-update. Run \`kick g agents -f\` (or \`kick g agent-docs -f\`) to regenerate from the latest CLI templates after \`kick add\` / version bumps. Hand-edited sections will be overwritten — keep customisation in a separate file like \`AGENTS.local.md\`.

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

/**
 * Generate `kickjs-skills.md` — task-oriented "skill" recipes for AI
 * agents (Claude superpowers, Copilot, etc.). Where AGENTS.md is the
 * narrative reference, this file lists short, rigid workflows the agent
 * should follow when it sees the corresponding trigger.
 */
export function generateKickJsSkills(name: string, _template: ProjectTemplate, pm: string): string {
  return `# kickjs-skills.md — Task Skills for AI Agents (${name})

This file is the agent-facing **skills index** for KickJS work in this
repo. Each block below is a short, rigid workflow keyed to a specific
trigger ("user wants to add a module", "tests are leaking state", etc.).

- Reference docs (narrative, exhaustive) → \`AGENTS.md\`.
- Tool-specific notes → \`CLAUDE.md\`, \`GEMINI.md\`, etc.
- **This file** → step-by-step recipes the agent should *execute*.

Re-run \`kick g agents -f --only skills\` after framework upgrades to refresh.

---

## Skill: add-module

\`\`\`yaml
name: kickjs-add-module
description: Use when the user asks to add a new feature module (controller + service + repo + DTOs).
\`\`\`

**Trigger phrases**: "add a users module", "scaffold tasks", "new feature for X".

**Steps**:
1. Run \`kick g module <name>\` (use plural form if the project pluralizes — check \`kick.config.ts\`).
2. Verify the new folder under \`src/modules/<name>/\` contains \`<name>.module.ts\` (filename suffix is mandatory for HMR).
3. Confirm the module appears in \`src/modules/index.ts\` exports — generator does this automatically; verify if you bypassed it.
4. Open \`<name>.dto.ts\` and tighten the Zod schemas to real fields (the generator emits placeholders).
5. Run \`${pm} run typecheck\` and \`${pm} run test\` before claiming done.

**Red flags** (stop and ask):
- File created as \`<name>.ts\` instead of \`<name>.module.ts\` — Vite won't HMR it.
- Module not registered in \`src/modules/index.ts\`.
- \`@Controller('/path')\` with a path argument — that's a v3 pattern; remove it (mount comes from \`routes().path\`).

---

## Skill: add-adapter

\`\`\`yaml
name: kickjs-add-adapter
description: Use when wiring a new lifecycle integration (Swagger, DevTools, Auth, custom).
\`\`\`

**Steps**:
1. \`kick g adapter <name>\` to scaffold the boilerplate, OR install via \`kick add <package>\` for first-party adapters.
2. The generated file uses \`defineAdapter()\` — never \`class implements AppAdapter\`.
3. Add the adapter instance to \`src/adapters/index.ts\` (don't inline in \`src/index.ts\`).
4. If the adapter contributes to \`ctx.set/get\`, prefer \`AppAdapter.contributors?()\` over a wrapping middleware.
5. Verify with \`kick dev\` that the adapter's lifecycle logs fire.

**Red flags**:
- Inlining the adapter list directly in \`src/index.ts\` (entry file should stay thin).
- Returning a plain object instead of going through \`defineAdapter()\` — type inference for \`config\` will be wrong.

---

## Skill: write-controller-test

\`\`\`yaml
name: kickjs-write-controller-test
description: Use when adding a Vitest test that exercises an HTTP route or DI graph.
\`\`\`

**Template** (copy/paste, adjust):

\`\`\`ts
import { describe, it, expect } from 'vitest'
import { Container } from '@forinda/kickjs'
import { createTestApp } from '@forinda/kickjs-testing'

describe('UserController', () => {
  it('returns users', async () => {
    const container = Container.create()           // isolated DI per test
    const app = await createTestApp([UserModule], { container })
    const res = await app.get('/users')
    expect(res.status).toBe(200)
  })
})
\`\`\`

**Red flags**:
- \`new Container()\` — wrong; use \`Container.create()\`.
- \`Container.getInstance().reset()\` — wrong; same fix.
- Sharing a container across \`it()\` blocks — leaks registrations.

---

## Skill: env-wiring-check

\`\`\`yaml
name: kickjs-env-wiring-check
description: Use when ConfigService.get('SOME_KEY') returns undefined or @Value silently falls back to process.env.
\`\`\`

**Diagnosis**:
1. Open \`src/index.ts\`. The **first non-\`reflect-metadata\`** import MUST be \`import './config'\`.
2. Open \`src/config/index.ts\`. It MUST call \`loadEnv(envSchema)\` as a top-level side effect.
3. The new key MUST be declared in the Zod schema there. \`@Value('NEW_KEY')\` won't work without a schema entry (it'll fall back to raw \`process.env\` and skip Zod coercion silently).

**Fix**: add the key to the schema; ensure both side-effect imports above are present.

---

## Skill: bootstrap-export

\`\`\`yaml
name: kickjs-bootstrap-export
description: Use when HMR is silently doing full restarts on every save, or createTestApp can't find the app handle.
\`\`\`

**Check** \`src/index.ts\`'s last line:

\`\`\`ts
// CORRECT
export const app = await bootstrap({ ... })

// WRONG (HMR degrades to full restart, createTestApp loses the handle)
await bootstrap({ ... })
\`\`\`

The Vite plugin imports the named \`app\` symbol; testing helpers do too.

---

## Skill: thin-entry-file

\`\`\`yaml
name: kickjs-thin-entry-file
description: Use when src/index.ts is accumulating module/middleware/plugin/adapter literals.
\`\`\`

**Refactor target**:

\`\`\`ts
// src/modules/index.ts
export const modules: AppModuleClass[] = [HelloModule, UsersModule, ...]

// src/middleware/index.ts
export const middleware = [helmet(), cors(), requestId(), ...]

// src/plugins/index.ts
export const plugins = [MetricsPlugin(), ...]

// src/adapters/index.ts
export const adapters = [SwaggerAdapter({ ... }), DevToolsAdapter()]

// src/index.ts — stays small
import 'reflect-metadata'
import './config'
import { bootstrap } from '@forinda/kickjs'
import { modules } from './modules'
import { middleware } from './middleware'
import { plugins } from './plugins'
import { adapters } from './adapters'
export const app = await bootstrap({ modules, middleware, plugins, adapters })
\`\`\`

**Red flags**: any \`new SomeAdapter()\` or \`SomePlugin()\` literal inside \`bootstrap({ ... })\` instead of imported from a category folder.

---

## Skill: context-contributor

\`\`\`yaml
name: kickjs-context-contributor
description: Use when a middleware's only job is to set ctx values consumed elsewhere — replace with defineHttpContextDecorator (HTTP) or defineContextDecorator (transport-agnostic).
\`\`\`

**Pattern** (HTTP — most common):

\`\`\`ts
import { defineHttpContextDecorator, type RequestContext } from '@forinda/kickjs'

const LoadTenant = defineHttpContextDecorator({
  key: 'tenant',
  deps: { repo: TENANT_REPO },
  resolve: (ctx, { repo }) => repo.findById(ctx.req.headers['x-tenant-id'] as string),
})

const LoadProject = defineHttpContextDecorator({
  key: 'project',
  dependsOn: ['tenant'],
  resolve: (ctx) => projectsRepo.find(ctx.get('tenant')!.id, ctx.params.id),
})

@LoadTenant
@LoadProject
@Get('/projects/:id')
getProject(ctx: RequestContext) { ctx.json(ctx.get('project')) }
\`\`\`

Use \`defineContextDecorator\` (no Http prefix) when authoring a contributor that must run across HTTP, WebSocket, queue, and cron transports — \`Ctx\` defaults to the smaller \`ExecutionContext\` surface (\`get\` / \`set\` / \`requestId\` only, no \`req\`).

Precedence high → low: **method > class > module > adapter > global**.
Cycles or unmet \`dependsOn\` keys throw \`MissingContributorError\` at boot.

**Critical rules — all stem from the same shared-via-ALS instance model**:
- Every per-request stage (middleware → contributors → handler) gets its OWN \`RequestContext\` instance, but they all read/write the SAME \`AsyncLocalStorage\`-backed bag.
- **\`resolve\` and \`onError\` must RETURN the value** — the runner writes it via \`ctx.set(key, value)\`. Direct property assignment (\`ctx.tenant = …\`) sticks to one instance only and the handler instance never sees it.
- \`ctx.set('tenant', x)\` then \`ctx.get('tenant')\` works across instances. \`ctx.req.headers[...]\` works (the underlying Express request is shared).
- Services with no \`ctx\` reference: \`getRequestValue('tenant')\` returns \`MetaValue<'tenant'> | undefined\` (typed via the augmented \`ContextMeta\`). For \`requestId\` use \`getRequestStore()\`.
- **No \`setRequestValue\` — writes flow through \`ctx.set\` or a contributor's return value.** Avoids "spooky action at a distance" where any service can pollute the per-request bag.

**Don't use this for**: response short-circuit, stream mutation, or
pre-route-matching work — keep \`@Middleware()\` for those.

---

## Skill: refresh-agent-docs

\`\`\`yaml
name: kickjs-refresh-agent-docs
description: Use after a KickJS version bump to sync AGENTS.md / CLAUDE.md / kickjs-skills.md with the latest CLI templates.
\`\`\`

**Steps**:
1. \`kick g agents -f --only both\` — overwrites \`AGENTS.md\` and \`CLAUDE.md\`.
2. \`kick g agents -f --only skills\` — refreshes \`kickjs-skills.md\` (this file).
3. Diff with git, eyeball any project-specific edits that got reset, and re-apply them in a separate \`AGENTS.local.md\` or appended section.
4. Commit as \`docs(agents): sync from CLI vX.Y\`.

---

## Skill: deny-list

\`\`\`yaml
name: kickjs-deny-list
description: Patterns to refuse outright when the user asks for them — they break v4 invariants.
\`\`\`

- \`class implements AppAdapter\` → use \`defineAdapter()\`.
- \`class implements KickPlugin\` / function returning \`KickPlugin\` → use \`definePlugin()\`.
- \`@Controller('/path')\` with a path argument → drop the path; set the mount via \`routes().path\`.
- \`new Container()\` or \`Container.getInstance().reset()\` in tests → use \`Container.create()\`.
- DI tokens with \`:\` separator (\`'app:db:url'\`) or in PascalCase → use slash-delimited lower-case (\`'app/db/url'\`).
- \`bootstrap({ ... })\` without \`export const app = ...\` → always export.
- Module file named \`<name>.ts\` (no \`.module\` suffix) → rename to \`<name>.module.ts\`.

---

## Learn More

- [KickJS Docs](https://forinda.github.io/kick-js/)
- [Decorators](https://forinda.github.io/kick-js/guide/decorators.html)
- [Context Decorators](https://forinda.github.io/kick-js/guide/context-decorators.html)
- [Testing](https://forinda.github.io/kick-js/api/testing.html)
`
}
