type ProjectTemplate = 'rest' | 'minimal'

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

  return `# ${name}

A **${templateLabels[template] ?? 'REST API'}** built with [KickJS](https://kickjs.app/) — a decorator-driven Node.js framework for TypeScript that runs on Express, Fastify, or h3 (swap the engine in one line).

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
kick add --list        # Show all available packages
\`\`\`

For email, scheduled tasks, multi-tenancy, OpenTelemetry, GraphQL, and notifications use the BYO recipes in the [KickJS guides](https://kickjs.app/guide/) — they wire the upstream library through \`defineAdapter()\` / \`definePlugin()\` directly, so you keep control of the integration.

## Environment Variables

Copy \`.env.example\` to \`.env\` and configure:

| Variable | Default | Description |
|---|---|---|
| \`PORT\` | \`3000\` | Server port |
| \`NODE_ENV\` | \`development\` | Environment |

## Learn More

- [KickJS Documentation](https://kickjs.app/)
- [CLI Reference](https://kickjs.app/api/cli.html)
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

**Read \`./.agents/AGENTS.md\` first.** It is the canonical, multi-agent
reference for this project (Claude, Copilot, Codex, Gemini, etc.) —
project conventions, structure, decorator patterns, env wiring, CLI
generators, every gotcha.

**Then browse \`./.agents/skills/\`.** Each subdirectory is a single
task-oriented skill (\`add-module/\`, \`write-controller-test/\`,
\`bootstrap-export/\`, \`deny-list/\`, …) containing a \`SKILL.md\`
with YAML frontmatter (\`name\`, \`description\`) and the recipe body.
The structure follows the Claude Code skills convention — agents that
auto-load skills from \`.agents/skills/\` will pick each up by its
frontmatter. Use this directory as the playbook when executing common
KickJS workflows.

This file is a thin Claude-specific layer on top of those two; when
they disagree on anything substantive, treat \`.agents/AGENTS.md\` as
authoritative and flag the discrepancy.

## Why \`.agents/\` + this thin pointer

\`.agents/AGENTS.md\` is what every agent reads (Codex, Cursor, Gemini,
Copilot, Aider, …) — one canonical source so the prose doesn't drift
across copies. \`CLAUDE.md\` is what Claude Code automatically loads as
project context on each conversation, so it stays at the project root.
Keeping CLAUDE.md slim and pointing at \`.agents/\` avoids two
out-of-sync copies of the same content. Per-agent files
(\`.agents/GEMINI.md\`, \`.agents/COPILOT.md\`) live alongside
\`AGENTS.md\` for tool-specific notes that don't belong in the shared
prose.

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

## Quick reference (full version in .agents/AGENTS.md)

\`\`\`bash
${pm} install            # Install dependencies
kick dev                 # Dev server with HMR + typegen
kick build && kick start # Production
${pm} run test           # Vitest
${pm} run typecheck      # tsc --noEmit
${pm} run format         # Prettier
\`\`\`

## v4 framework reminders

When generating or modifying code in this project, stay aligned with the v4 conventions documented in \`.agents/AGENTS.md\`:

- **Adapters**: \`defineAdapter()\` factory — never \`class implements AppAdapter\`.
- **Plugins**: \`definePlugin()\` factory — never plain function returning \`KickPlugin\`.
- **DI tokens**: \`<scope>/<PascalKey>[/<suffix>]\` — scope is lowercase, the key segment is **PascalCase** (e.g. \`'app/Users/repository'\`, \`'mycorp/Cache/redis'\`). First-party uses the reserved \`'kick/'\` prefix; this project owns its own scope.
- **Decorators**: \`@Controller()\` (no path arg — mount prefix comes from \`routes().path\`).
- **HTTP runtime**: this app may run on Express, Fastify, or h3 — check \`kick.config.ts\` \`runtime\` (or \`bootstrap({ runtime })\`) before writing engine-specific code. Prefer engine-neutral \`ctx\` APIs (\`ctx.json\`/\`ctx.body\`/\`ctx.params\`/\`ctx.sse\`); don't assume \`ctx.req\` is an Express request. Uploads (\`@FileUpload\` → \`ctx.file\`/\`ctx.files\`) work on all three (\`kick add upload\` installs the driver). Full rules in \`.agents/AGENTS.md\` → "HTTP runtime".
- **Module entry file** MUST be named \`<name>.module.ts\` and live under \`src/modules/<name>/\`. The Vite plugin auto-discovers \`*.module.[tj]sx?\` for graceful HMR — a misnamed \`projects.ts\` silently degrades every save into a full restart.
- **Env**: schema lives in \`src/config/index.ts\`; \`import './config'\` MUST be the first import in \`src/index.ts\` (side-effect registers the schema before any \`@Value\` resolves).
- **Assets**: drop new template files into \`src/templates/<namespace>/\`; the dev watcher auto-rebuilds the \`KickAssets\` augmentation + \`assets.x.y()\` re-walks on next call. No restart, no manual build.
- **Context Contributors** (\`defineContextDecorator\`) over \`@Middleware()\` for ctx-population work.
- **Repos under tests**: \`Container.create()\` for isolation — never \`new Container()\` or \`getInstance().reset()\`.
- **Bootstrap export**: \`src/index.ts\` must end with \`export const app = await bootstrap({ ... })\`. The Vite plugin and \`createTestApp\` import the named \`app\`; without the export, HMR silently degrades to full restarts.
- **Thin entry file**: aggregate \`modules\`, \`middleware\`, \`plugins\`, \`adapters\` in their own folders (\`src/modules/index.ts\`, \`src/middleware/index.ts\`, …) and pass them by name to \`bootstrap()\` — never inline the lists in \`src/index.ts\`.
- **Refresh these files**: \`kick g agents -f\` regenerates \`CLAUDE.md\` at the project root and \`.agents/AGENTS.md\` + \`.agents/GEMINI.md\` + \`.agents/COPILOT.md\` + every \`.agents/skills/<name>/SKILL.md\` from the latest CLI templates. Hand-edited content is overwritten — keep customisation in \`.agents/AGENTS.local.md\` or per-skill \`SKILL.local.md\` files alongside.

For everything else (controllers, services, modules, RequestContext API, generators, CLI commands, package additions, env wiring, troubleshooting) → \`.agents/AGENTS.md\`.
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

This is a **${templateLabels[template] ?? 'REST API'}** application built with [KickJS](https://kickjs.app/) — a decorator-driven Node.js framework on Express 5 and TypeScript.

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

Modules are built with \`defineModule()\` and wire controllers via \`buildRoutes()\`. The legacy \`class … implements AppModule\` form keeps working — the loader accepts both — but new generators emit \`defineModule\` for parity with \`defineAdapter\` and \`definePlugin\`.

> **Naming matters.** Module files **must** be named \`<name>.module.ts\` and live under \`src/modules/\`. The Vite plugin auto-discovers files matching \`*.module.[tj]sx?\` for HMR — a misnamed file (e.g., \`projects.ts\`) won't trigger a graceful module rebuild on save and will require a full server restart. The CLI generator (\`kick g module <name>\`) follows this convention automatically.

\`\`\`ts
// src/modules/users/users.module.ts   (named <feature>.module.ts)
import { defineModule } from '@forinda/kickjs'
import { UserController } from './user.controller'

export const UserModule = defineModule({
  name: 'UserModule',
  build: () => ({
    routes() {
      // Single route set — framework derives the router via buildRoutes(controller).
      return {
        path: '/users',
        controller: UserController,
      }
    },
  }),
})
\`\`\`

\`routes()\` can also return **an array** to mount multiple route sets under the same module — useful when one feature spans several controllers, or when you want a v1 and v2 surface of the same controller live side-by-side. Each route set carries an optional \`version\` field overriding the app default (\`Application.defaultVersion\`); the mount path becomes \`/{apiPrefix}/v{version}{path}\`:

\`\`\`ts
import { defineModule } from '@forinda/kickjs'
import { UsersV1Controller } from './v1/users.controller'
import { UsersV2Controller } from './v2/users.controller'
import { UserAdminController } from './admin/user-admin.controller'

export const UserModule = defineModule({
  name: 'UserModule',
  build: () => ({
    routes() {
      return [
        // /api/v1/users — legacy surface kept around for older clients
        { path: '/users', version: 1, controller: UsersV1Controller },
        // /api/v2/users — current surface
        { path: '/users', version: 2, controller: UsersV2Controller },
        // /api/v1/admin/users — admin surface, same module, different mount
        { path: '/admin/users', controller: UserAdminController },
      ]
    },
  }),
})
\`\`\`

Register all modules in \`src/modules/index.ts\` via \`defineModules()\` — a chainable list builder that drops directly into \`bootstrap({ modules })\`. \`kick g module <name>\` appends \`.mount(NewModule())\` to the chain on every generation:

\`\`\`ts
import { defineModules } from '@forinda/kickjs'
import { UserModule } from './users/user.module'
import { TaskModule } from './tasks/task.module'

export const modules = defineModules().mount(UserModule()).mount(TaskModule())
\`\`\`

The flat-array form (\`AppModuleEntry[] = [UserModule()]\`) also works and is what \`kick.config.ts > modules.style: 'class'\` emits — both shapes feed the same loader.

\`\`\`ts
// Setting on \`kick.config.ts\` to opt out of \`defineModule\` codegen.
export default defineConfig({
  pattern: 'rest',
  modules: {
    style: 'class', // emits \`class FooModule implements AppModule { ... }\`
                    //   + flat-array registry \`[FooModule]\`
                    // default is 'define' (defineModule + defineModules chain).
  },
})
\`\`\`

When the project-wide style and existing module files drift (e.g. \`style: 'define'\` on a project that still has class-form modules), \`kick g module\` refuses with a pointer to \`kick codemod modules --experimental --apply\` which rewrites between the two forms in either direction.

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

> **Context decorators** — when a middleware's only job is to populate \`ctx.set/get\` for the handler to read, prefer \`defineContextDecorator()\` over \`@Middleware()\`. Typed via \`ContextMeta\`, supports \`dependsOn\` ordering, validates the pipeline at boot. Full pattern reference in \`AGENTS.md\` and at <https://kickjs.app/guide/context-decorators>.

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
\`\`\`

## Adding Packages

\`\`\`bash
kick add auth          # JWT, API key, OAuth strategies
kick add swagger       # OpenAPI docs from decorators
kick add ws            # WebSocket support
kick add queue         # Background jobs (BullMQ/RabbitMQ/Kafka)
kick add prisma        # Prisma ORM adapter
kick add drizzle       # Drizzle ORM adapter
kick add devtools      # Browser debug dashboard
kick add --list        # Show all available packages

# For email, scheduled tasks, multi-tenancy, OpenTelemetry, GraphQL, and
# notifications use the BYO recipes in https://kickjs.app/guide/
# — they wire the upstream library through defineAdapter()/definePlugin() directly.
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
// Convention: '<scope>/<PascalKey>[/<suffix>]' — scope lowercase, key PascalCase.
const DB_URL = createToken<string>('app/Config/database-url')
const FEATURE_FLAGS = createToken<FeatureFlags>('app/Features')
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

## Common Pitfalls

1. **Decorators fire at import time** — make sure to import module classes in \`src/modules/index.ts\`
2. **Tests need \`Container.reset()\`** — call in \`beforeEach\` to isolate DI state
3. **Always use \`ctx.body\`** — never \`req.body\` directly
4. **DI requires \`reflect-metadata\`** — already imported in \`src/index.ts\`
5. **Vite HMR requires proper cleanup** — adapters should implement \`shutdown()\`
6. **Never delete \`import './config'\` from \`src/index.ts\`** — that side-effect import registers the env schema with kickjs. Without it \`ConfigService.get('YOUR_KEY')\` returns \`undefined\` for every user-defined key. \`@Value('YOUR_KEY')\` *appears* to keep working but only via a raw \`process.env\` fallback (Zod coercion + schema defaults are silently skipped).

## Learn More

- [KickJS Documentation](https://kickjs.app/)
- [API Reference](https://kickjs.app/api/)
- [CLI Commands](https://kickjs.app/guide/cli-commands.html)
- [Decorators Guide](https://kickjs.app/guide/decorators.html)
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
3. Read the [KickJS documentation](https://kickjs.app/) for framework details

## HTTP runtime — DON'T assume Express-only

KickJS is **engine-pluggable**. It runs on **Express (default), Fastify, or h3** —
chosen with one line: \`bootstrap({ runtime: fastifyRuntime() })\`. Before writing
any engine-specific code, **check which engine this project uses**:

- \`kick.config.ts\` → the \`runtime\` field (\`'express'\` | \`'fastify'\` | \`'h3'\`), and/or
- \`src/index.ts\` → the \`runtime:\` passed to \`bootstrap()\`, and/or
- \`package.json\` → \`fastify\` / \`h3\` in deps.

Rules that keep generated code correct on **every** engine:

- **Write to \`ctx\`, not the raw request/response.** \`ctx.json()\`, \`ctx.body\`,
  \`ctx.params\`, \`ctx.query\`, \`ctx.set/get\`, \`ctx.sse()\` are engine-neutral and
  work identically everywhere. \`ctx.req\` / \`ctx.res\` are the engine-native
  objects — their **type follows the active runtime** (Express by default; the
  \`kick/runtime\` typegen retypes them to Fastify / h3 when \`runtime\` is set).
  Don't assume \`ctx.req\` is an \`express.Request\` in portable code.
- **Global middleware** in \`bootstrap({ middleware })\` is connect-style
  \`(req, res, next)\` — it runs on all engines (Fastify via \`@fastify/middie\`,
  h3 via \`fromNodeMiddleware\`). But on Fastify / h3 the engine parses the body
  natively, so the default \`express.json()\` is **auto-skipped** (\`nativeBodyParsing\`).
  Don't add \`express.json()\` manually on those engines.
- **File uploads** work on all three: \`@FileUpload({ mode, fieldName, ... })\` →
  \`ctx.file\` / \`ctx.files\` (same Multer-shaped object everywhere). Backends:
  Express \`multer\`, Fastify \`@fastify/multipart\`, h3 native. Run
  \`kick add upload\` to install the runtime-correct driver. The \`@FileUpload\`
  decorator is **memory-only** (portable); disk / custom-storage (\`storage\` /
  \`dest\`) is Express-only via the \`upload.single/array()\` middleware.
- **Engine subpaths**: \`import { fastifyRuntime } from '@forinda/kickjs/fastify'\`
  or \`h3Runtime\` from \`'@forinda/kickjs/h3'\`. Express is the zero-config default
  (no import, nothing to install).
- **Not supported on Fastify / h3**: \`ctx.render()\` (no view engine). Calling it
  throws a clear error rather than failing silently.
- Run \`kick doctor\` to verify the runtime's engine peers + upload driver are installed.

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

- **DI tokens** — \`<scope>/<PascalKey>[/<suffix>]\`. Scope is lowercase,
  the key segment is **PascalCase** (the regex enforces both):

  \`\`\`ts
  const USERS_REPO = createToken<UsersRepo>('app/Users/repository')
  const DB         = createToken<Database>('app/Db/connection')
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
  // src/modules/index.ts — fluent chain (default for \`modules.style: 'define'\`)
  export const modules = defineModules().mount(HelloModule()).mount(UsersModule())
  // OR with \`modules.style: 'class'\`:
  //   export const modules: AppModuleEntry[] = [HelloModule, UsersModule]

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
  template === 'rest'
    ? `\`\`\`
<name>/
├── <name>.controller.ts     # HTTP routes (@Controller)
├── <name>.service.ts        # Business logic (@Service)
├── <name>.repository.ts     # Data access (@Repository)
├── dtos/                    # Request/response schemas (Zod)
└── <name>.module.ts         # Module definition (defineModule factory)
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
- [ ] Create module file with \`defineModule({ name, build: () => ({ routes() { return { path, controller } } }) })\` — the framework derives the Express router from the controller. Class-form (\`class XModule implements AppModule\`) is the legacy alternative; toggle via \`kick.config.ts > modules.style\`.
- [ ] Register module in \`src/modules/index.ts\`. Default form is the fluent chain: \`defineModules().mount(MyModule()).mount(...)\`. \`kick g module <name>\` appends \`.mount(NewModule())\` automatically.
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
| \`createToken<T>(name)\` | \`@forinda/kickjs\` | \`const TOKEN = createToken<string>('app/Db/url')\` |
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
| \`defineModule({...})\` | Define feature module (factory; preferred — paired with \`defineModules()\` registry) |
| \`defineModules()\` | Build the modules registry as a chainable list (\`.mount(X())\`) |
| \`AppModule\` interface | Legacy module shape — \`class X implements AppModule\` (toggle via \`modules.style: 'class'\`) |
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
| Module hook | \`build: () => ({ contributors() { return [...] } })\` (\`defineModule\`) — or \`AppModule.contributors?()\` for class form |
| Adapter hook | \`AppAdapter.contributors?(): ContributorRegistration[]\` |
| Global registration | \`bootstrap({ contributors: [LoadX.registration] })\` |
| Type augmentation | \`declare module '@forinda/kickjs' { interface ContextMeta { ... } }\` |

Precedence high → low: **method > class > module > adapter > global**.
Cycles and missing \`dependsOn\` keys throw at \`app.setup()\` (boot fails
fast). The \`onError\` hook is async-permitted.

Full guide: <https://kickjs.app/guide/context-decorators>.

## Common Pitfalls

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
| \`kick add upload\` | Install the multipart upload driver for this project's runtime |
| \`kick add --list\` | List available packages |
| \`kick doctor\` | Pre-flight checks — runtime engine peers, upload driver, env wiring |
| \`kick rm module <names...>\` | Remove one or more modules |

> **Note:** When using \`kick new\` in scripts or CI, pass \`-t\` (or \`--template\`), \`-r\` (or \`--repo\`), and \`--runtime express|fastify|h3\` to bypass interactive prompts:
> \`\`\`bash
> kick new my-api -t ddd -r prisma --runtime fastify --pm ${pm} --no-git --no-install -f
> \`\`\`

## Learn More

- [KickJS Docs](https://kickjs.app/)
- [CLI Reference](https://kickjs.app/api/cli.html)
- [Decorators Guide](https://kickjs.app/guide/decorators.html)
- [DI System](https://kickjs.app/guide/dependency-injection.html)
- [Testing](https://kickjs.app/api/testing.html)
`
}

/**
 * One emitted skill — slug becomes the directory name under
 * `.agents/skills/<slug>/SKILL.md`. `frontmatterName` is the value
 * agents use to look the skill up at activation time and follows the
 * `kickjs-<slug>` convention to keep the skill registry namespaced.
 */
export interface KickJsSkillFile {
  /** kebab-case directory name (`add-module`, `write-controller-test`). */
  slug: string
  /** Full SKILL.md content with YAML frontmatter + body. */
  content: string
}

/**
 * Render every KickJS task-skill as its own `SKILL.md` file, ready to
 * write under `.agents/skills/<slug>/SKILL.md`. Each file follows the
 * standard Claude Code skill format:
 *
 * ```
 * ---
 * name: kickjs-<slug>
 * description: <when to use this skill>
 * ---
 *
 * <body>
 * ```
 *
 * Agents that auto-discover skills from `.agents/skills/` (Claude
 * Code, Copilot CLI plugins, Gemini's activate_skill) pick each up by
 * its frontmatter without us shipping an index file. The legacy
 * single-file format (`kickjs-skills.md`) is gone — adopters with
 * existing root-level copies keep them untouched until they run
 * `kick g agents -f --only skills`, which emits the new layout
 * alongside without deleting the old file.
 */
export function generateKickJsSkillFiles(
  name: string,
  _template: ProjectTemplate,
  pm: string,
): KickJsSkillFile[] {
  const banner = `<!-- Generated by \`kick g agents\` for ${name}. Edits are overwritten on the next refresh; keep customisation in a SKILL.local.md alongside. -->`

  const skills: Array<{
    slug: string
    frontmatterName: string
    description: string
    body: string
  }> = [
    {
      slug: 'add-module',
      frontmatterName: 'kickjs-add-module',
      description:
        'Use when the user asks to add a new feature module (controller + service + repo + DTOs).',
      body: `**Trigger phrases**: "add a users module", "scaffold tasks", "new feature for X".

**Steps**:
1. Run \`kick g module <name>\` (use plural form if the project pluralizes — check \`kick.config.ts\`).
2. Verify the new folder under \`src/modules/<name>/\` contains \`<name>.module.ts\` (filename suffix is mandatory for Vite HMR).
3. Confirm the module appears in \`src/modules/index.ts\` exports — generator does this automatically; verify if you bypassed it.
4. Open \`<name>.dto.ts\` and tighten the Zod schemas to real fields (the generator emits placeholders).
5. Run \`${pm} run typecheck\` and \`${pm} run test\` before claiming done.

**Canonical module shape** — \`defineModule\` factory, never \`class implements AppModule\`:

\`\`\`ts
export const TodosModule = defineModule({
  name: 'TodosModule',
  build: () => ({
    register(container) {
      container.registerFactory(TODO_REPO, () => container.resolve(InMemoryTodoRepository))
    },
    routes() {
      return { path: '/todos', controller: TodosController }
    },
  }),
})
\`\`\`

The module file MUST include \`import.meta.glob([...], { eager: true })\` for every \`@Controller\` / \`@Service\` / \`@Repository\` / \`@Component\` class — without it, decorators never fire and DI silently resolves to \`undefined\` (or routes vanish). Use **recursive** patterns (\`./**/*.controller.ts\`) so the glob keeps working when you nest files into sub-folders (\`controllers/\`, \`presentation/\`, …). If you reorganise and a class stops loading, \`kick typegen\` flags it as orphaned and \`kick typegen --fix\` patches the glob for you.

**Multiple route sets / versioning** — \`routes()\` may return an array with per-entry \`version\` override:

\`\`\`ts
routes() {
  return [
    { path: '/todos', controller: TodosController },               // /api/v1/todos
    { path: '/todos', version: 2, controller: TodosV2Controller }, // /api/v2/todos
  ]
}
\`\`\`

**Conditional / per-tenant mounting** — use \`bootstrap({ setup(registry) { registry.mount(...) } })\`, not the static \`modules\` array.

**Composition** — \`defineModules().mount(TodosModule()).mount(UsersModule())\` (fluent) or \`AppModuleEntry[]\` (array form).

**Red flags** (stop and ask):
- File created as \`<name>.ts\` instead of \`<name>.module.ts\` — Vite plugin's \`*.module.[tj]sx?\` glob doesn't pick it up; every save becomes a full restart.
- \`@Controller('/path')\` with a path argument combined with module \`routes().path\` — duplicates the prefix. The decorator path is OpenAPI metadata only.
- \`TodosModule\` in \`bootstrap({ modules: [TodosModule] })\` instead of \`TodosModule()\` — passing the factory instead of the invoked instance.
- \`routes()\` returning \`router: …\` when a \`controller:\` would do — controller form is required for OpenAPI/Swagger introspection.
- Module not registered in \`src/modules/index.ts\`.`,
    },
    {
      slug: 'add-adapter',
      frontmatterName: 'kickjs-add-adapter',
      description:
        'Use when wiring a single-concern lifecycle integration (Swagger, DevTools, Sentry, Redis client).',
      body: `**Steps**:
1. \`kick g adapter <name>\` to scaffold the boilerplate, OR install via \`kick add <package>\` for first-party adapters.
2. The generated file uses \`defineAdapter()\` — never \`class implements AppAdapter\`.
3. Add the adapter instance (note the parens) to \`src/adapters/index.ts\` — don't inline in \`src/index.ts\`.
4. Pick the right hook and middleware phase deliberately.
5. Verify with \`kick dev\` that the adapter's lifecycle logs fire.

**Canonical shape** — factory closure owns instance state:

\`\`\`ts
export const RedisAdapter = defineAdapter<RedisConfig>({
  name: 'RedisAdapter',
  defaults: { url: 'redis://localhost' },
  build: (config) => {
    const client = createClient(config.url)
    return {
      beforeStart: ({ container }) => {
        container.registerInstance(REDIS_CLIENT, client)
      },
      afterStart: () => client.connect(),
      shutdown: () => client.quit(),
    }
  },
})

// In src/adapters/index.ts:
export const adapters = [RedisAdapter({ url: env.REDIS_URL })] // <-- note parens
\`\`\`

**Lifecycle hook decision tree**:
- \`beforeMount\` — register early routes that should bypass middleware (health, docs UI).
- \`beforeStart\` — DI ready, server not listening yet. **Use this for \`container.registerInstance(...)\` calls** so they work under \`createTestApp\` too.
- \`afterStart\` — server has \`ctx.server\` available. Only use for things that need a listening server (Socket.IO upgrades, port logging). **Doesn't fire under \`createTestApp\`.**
- \`shutdown\` — runs concurrently via \`Promise.allSettled\`, so one failure doesn't block siblings (but errors are swallowed — log inside).

**Middleware phases** (see \`MiddlewarePhase\` JSDoc):
\`beforeGlobal\` | \`afterGlobal\` (default) | \`beforeRoutes\` | \`afterRoutes\` (fires only on fall-through — matched routes that respond skip it).

**Multi-instance** — \`.scoped('cache', { url: ... })\` makes \`name\` become \`RedisAdapter:cache\`. **Deferred config** — \`.async({ inject, useFactory })\` for config that depends on DI-resolved services.

**Red flags**:
- \`bootstrap({ adapters: [MyAdapter] })\` — passed the factory, not the instance. Call it: \`MyAdapter()\`.
- Inlining the adapter list directly in \`src/index.ts\` — entry file should stay thin.
- Returning a plain object instead of going through \`defineAdapter()\` — type inference for \`config\` will be wrong.
- Using \`.async()\` for an adapter that returns \`middleware()\` / \`contributors()\` / \`beforeMount()\` / \`onRouteMount()\` — those hooks have already run by the time \`.async()\` resolves and are silently skipped.
- Cross-adapter ordering via array position when it's load-bearing — use \`dependsOn: ['OtelAdapter']\`; cycles throw \`MountCycleError\` at boot.
- Using an adapter when the integration ships **modules + DI bindings + middleware** together → that's a plugin. Promote to \`definePlugin()\` (see \`add-plugin\` skill).

**Nuances**:
- \`AdapterContext.server\` is \`undefined\` outside \`afterStart\`.
- \`shutdown\` errors are swallowed by \`Promise.allSettled\` — wrap in try/catch and log if you care.`,
    },
    {
      slug: 'add-plugin',
      frontmatterName: 'kickjs-add-plugin',
      description:
        'Use when scaffolding a feature that bundles modules + DI + middleware + adapters together (auth, monitoring suite, multi-tenant scaffolding).',
      body: `**When plugin > adapter**: a plugin is the right answer when the integration ships **more than one** of: a module, a DI binding, middleware, or another adapter. If you have a single hook (\`beforeStart\`) and no other contributions, use \`defineAdapter\` instead.

**Canonical shape**:

\`\`\`ts
import { definePlugin } from '@forinda/kickjs'

export const AuthPlugin = definePlugin({
  name: 'AuthPlugin',
  defaults: { tokenTtl: '1h' },
  build: (config, { name }) => ({
    modules: () => [AuthModule()],
    adapters: () => [JwtAdapter({ ttl: config.tokenTtl })],
    middleware: () => [requestIdMiddleware()],
    register(container) {
      container.registerFactory(TOKEN_SIGNER, () => createSigner(config))
    },
    contributors() {
      return [LoadCurrentUser.registration]
    },
    onReady({ server }) {
      log.info(\`AuthPlugin listening on port \${server.address().port}\`)
    },
  }),
})

// In bootstrap:
bootstrap({ plugins: [AuthPlugin({ tokenTtl: env.TOKEN_TTL })] }) // <-- parens
\`\`\`

**Inline plugin literal** — the canonical answer for one-off DI bindings. There's no top-level \`register:\` on \`bootstrap\` itself:

\`\`\`ts
bootstrap({
  plugins: [{ name: 'vector-store', register(c) { c.registerInstance(VECTOR_STORE, store) } }],
})
\`\`\`

**Execution order** (memorize):
plugin \`register()\` → plugin \`middleware()\` → plugin \`modules()\` + user modules → plugin \`adapters()\` + user adapters → server listens → plugin \`onReady()\`.

**Static vs dynamic modules**: \`modules()\` returning an array is introspectable (Swagger, DevTools see it). \`setup(registry)\` is imperative — pick the latter when the module set depends on resolved config.

**Multi-instance** — \`.scoped('users', { url })\`; derive unique DI tokens from \`ctx.name\` inside \`build\`:

\`\`\`ts
build: (config, { name }) => ({
  register(c) {
    c.registerInstance(createToken(\`cache/\${name}\`), client)
  },
})
\`\`\`

**Precedence**: plugin contributors land at \`'adapter'\` precedence — beat global, lose to module/class/method same-key.

**Red flags**:
- \`bootstrap({ plugins: [AuthPlugin] })\` — passed factory. Call it: \`AuthPlugin()\`.
- Reaching for a plugin when an adapter would do (no modules, no DI bindings, no contributors) — overkill; use \`defineAdapter()\`.
- \`.async()\` plugin that depends on \`modules()\` / \`middleware()\` / \`adapters()\` / \`contributors()\` — those are dropped. \`.async()\` only resolves \`register()\` + \`onReady()\`.
- Confusing CLI plugins (\`defineCliPlugin\` from \`@forinda/kickjs-cli\`) with runtime plugins (\`definePlugin\` from \`@forinda/kickjs\`) — different surfaces, different registration sites.
- \`dependsOn: ['SomePlugin']\` referring to a plugin not in the boot list — throws \`MissingMountDepError\` at boot.

**Nuances**:
- \`definition\` is \`Object.freeze\`'d metadata; useful for version checks (\`compare(AuthPlugin.definition.version, '1.2.0')\`) — not mountable.`,
    },
    {
      slug: 'write-controller-test',
      frontmatterName: 'kickjs-write-controller-test',
      description: 'Use when adding a Vitest test that exercises an HTTP route or DI graph.',
      body: `**Template** (copy/paste, adjust):

\`\`\`ts
import { describe, it, expect, beforeEach } from 'vitest'
import { Container } from '@forinda/kickjs'
import { createTestApp } from '@forinda/kickjs-testing'

beforeEach(() => {
  Container.reset() // isolated DI per test
})

describe('UserController', () => {
  it('returns users', async () => {
    const app = await createTestApp([UserModule])
    const res = await app.get('/api/v1/users')
    expect(res.status).toBe(200)
  })
})
\`\`\`

**Typed handler signature** — pair with \`kick typegen\` so \`ctx.body\` / \`params\` / \`query\` are typed by the route's Zod schema:

\`\`\`ts
@Post('/', { body: createTodoSchema })
create(ctx: Ctx<KickRoutes.TodoController['create']>) {
  // ctx.body is typed from createTodoSchema; ctx.params from the route
  ctx.created(await this.service.create(ctx.body))
}
\`\`\`

**Red flags**:
- \`new Container()\` — wrong; use \`Container.reset()\` in \`beforeEach\` or \`Container.create()\` for fully isolated graphs.
- \`Container.getInstance().reset()\` — wrong; same fix.
- Sharing a container instance across \`it()\` blocks — leaks registrations between tests.
- Injecting a \`Scope.REQUEST\` service into a \`SINGLETON\` — container throws at resolve. Singletons must resolve request-scoped services explicitly per call.
- Calling \`getRequestValue<string>('traceId')\` — the generic slot is the **key** type, not the value type; widens key and bypasses typed lookup.
- Asserting on \`res.body.requestId\` when \`requestId()\` middleware isn't mounted in the test app — value will be \`undefined\`.
- Using \`Scope.REQUEST\` services in a test without mounting \`requestScopeMiddleware()\` — \`getRequestValue\` silently returns \`undefined\`; \`getRequestStore\` throws.

**Nuances**:
- \`@Inject\` and \`@Autowired\` are interchangeable — same runtime, same types; pick by readability.
- \`@Value('MISSING_KEY')\` with no default **throws on property access**, not at construction — tests that exercise the getter will surface the missing-env issue.`,
    },
    {
      slug: 'env-wiring-check',
      frontmatterName: 'kickjs-env-wiring-check',
      description:
        "Use when ConfigService.get('SOME_KEY') returns undefined or @Value silently falls back to process.env.",
      body: `**Diagnosis (in order)**:
1. Open \`src/index.ts\`. The **first non-\`reflect-metadata\`** import MUST be \`import './config'\`.
2. Open \`src/config/index.ts\`. It MUST call \`loadEnv(envSchema)\` as a top-level side effect — not just declare the schema:
   \`\`\`ts
   import { loadEnv, defineEnv } from '@forinda/kickjs'
   const envSchema = defineEnv((base) => base.extend({ DATABASE_URL: z.string().url() }))
   export const env = loadEnv(envSchema)
   \`\`\`
3. The new key MUST be declared in the Zod schema. \`@Value('NEW_KEY')\` accepts any string at the type level and **falls back to raw \`process.env\`** when the schema doesn't know the key — silently skipping Zod coercion.
4. After adding a key, re-run \`kick typegen\` (or restart \`kick dev\` if the typegen watcher missed it) so the global \`KickEnv\` augmentation picks it up.

**Why \`@Value\` "works" but \`ConfigService.get\` doesn't**: \`@Value\` has the \`process.env\` fallback that masks missing-side-effect-import bugs; \`ConfigService\` has none. If \`@Value('FOO')\` returns a value but \`ConfigService.get('FOO')\` returns \`undefined\`, the side-effect import of \`./config\` is missing.

**\`reloadEnv\` vs \`resetEnvCache\`** — distinct, frequently mixed up:
- \`reloadEnv()\` — re-reads \`process.env\` against the **already registered** schema. Use in HMR plugins after \`.env\` file changes. Schema survives.
- \`resetEnvCache()\` — drops the registered schema entirely. **Test-only.** Calling it between dev requests drops the project's keys.

**Nuances**:
- \`loadEnv()\` cache is **sticky**: once \`loadEnv(extendedSchema)\` runs anywhere, no-arg calls reuse it — but only if it actually ran. Schema downgrades silently if \`src/config/index.ts\` isn't imported.
- \`createConfigService(envSchema)\` is deprecated; the typegen-driven \`ConfigService\` covers it.
- \`dotenv\` is an **optional peer dep** in v5+ — projects upgrading from older versions may need to add it explicitly.
- For HMR-friendly \`.env\` edits, add \`envWatchPlugin()\` to \`vite.config.ts\` — calls \`reloadEnv()\` automatically.

**Fix recipe**: add the key to the schema; add \`import './config'\` as the first non-reflect-metadata import in \`src/index.ts\`; re-run \`kick typegen\`.`,
    },
    {
      slug: 'bootstrap-export',
      frontmatterName: 'kickjs-bootstrap-export',
      description:
        "Use when HMR is silently doing full restarts on every save, or createTestApp can't find the app handle.",
      body: `**Check** \`src/index.ts\`'s last line:

\`\`\`ts
// CORRECT — Vite plugin + createTestApp import the named \`app\` symbol
export const app = await bootstrap({ ... })

// WRONG — HMR degrades to full restart, createTestApp loses the handle
await bootstrap({ ... })
\`\`\`

The Vite plugin imports the named \`app\` symbol via \`virtual:kickjs/app\`; testing helpers do too. Without the export, both fall back to slower paths (full restart on save, mock handle in tests) **without warning**.

**Red flags**:
- A bare \`await bootstrap(...)\` with no \`export\` — fix by adding \`export const app =\`.
- Re-assigning \`app\` later in the file (\`app = somethingElse\`) — Vite imports by reference at module-load time; reassignments don't propagate.
- Multiple files calling \`bootstrap()\` — only the entry should. Tests use \`createTestApp\` instead.`,
    },
    {
      slug: 'thin-entry-file',
      frontmatterName: 'kickjs-thin-entry-file',
      description:
        'Use when src/index.ts is accumulating module/middleware/plugin/adapter literals.',
      body: `**Refactor target**:

\`\`\`ts
// src/modules/index.ts — fluent chain (default for \`modules.style: 'define'\`)
export const modules = defineModules().mount(HelloModule()).mount(UsersModule())
// OR for class-form projects (\`modules.style: 'class'\`):
//   export const modules: AppModuleEntry[] = [HelloModule, UsersModule]

// src/middleware/index.ts — global middleware uses RAW EXPRESS signature
//                            (req, res, next), NOT (ctx, next)
export const middleware = [requestId(), express.json(), helmet(), cors(), traceContext()]

// src/plugins/index.ts
export const plugins = [MetricsPlugin(), AuthPlugin({ tokenTtl: env.TOKEN_TTL })]

// src/adapters/index.ts
export const adapters = [SwaggerAdapter({ ... }), DevToolsAdapter()]

// src/index.ts — stays small
import 'reflect-metadata'
import './config' // MUST be early — side-effect schema load
import { bootstrap } from '@forinda/kickjs'
import { modules } from './modules'
import { middleware } from './middleware'
import { plugins } from './plugins'
import { adapters } from './adapters'
export const app = await bootstrap({ modules, middleware, plugins, adapters })
\`\`\`

**One-off DI binding** — inline a literal plugin inside \`plugins\`, not a top-level option:

\`\`\`ts
plugins: [
  ...plugins,
  { name: 'vector-store', register(c) { c.registerInstance(VECTOR_STORE, store) } },
]
\`\`\`

**Red flags**:
- Any \`new SomeAdapter()\` / \`SomePlugin()\` literal inside \`bootstrap({ ... })\` instead of imported from a category folder.
- Mixing middleware signatures: \`bootstrap({ middleware })\` is **raw Express** \`(req, res, next)\`; \`@Middleware()\` decorators are \`(ctx, next)\`; adapter middleware is raw Express again. Wrong shape in the wrong slot throws "Cannot read properties of undefined".
- \`bootstrap({ register: ... })\` — that option doesn't exist. Use an inline plugin.`,
    },
    {
      slug: 'context-contributor',
      frontmatterName: 'kickjs-context-contributor',
      description:
        "Use when a middleware's only job is to set ctx values consumed elsewhere — replace with defineHttpContextDecorator (HTTP) or defineContextDecorator (transport-agnostic).",
      body: `**Pattern** (HTTP — most common):

\`\`\`ts
import { defineHttpContextDecorator, type RequestContext } from '@forinda/kickjs'

// Augment ContextMeta — required for ctx.get('tenant') to be typed
declare module '@forinda/kickjs' {
  interface ContextMeta {
    tenant: { id: string; name: string }
  }
}

// Optionally publish discoverability for tooling (Swagger, DevTools)
defineAugmentation('ContextMeta', {
  description: 'Per-request tenant resolved from x-tenant-id header.',
  example: { id: 'acme', name: 'Acme Inc' },
})

const LoadTenant = defineHttpContextDecorator({
  key: 'tenant',
  deps: { repo: TENANT_REPO }, // typed DI
  resolve: (ctx, { repo }) => repo.findById(ctx.req.headers['x-tenant-id'] as string),
})

const LoadProject = defineHttpContextDecorator({
  key: 'project',
  dependsOn: ['tenant'], // typo'd key = tsc error
  resolve: (ctx) => projectsRepo.find(ctx.get('tenant')!.id, ctx.params.id),
})

@LoadTenant
@LoadProject
@Get('/projects/:id')
getProject(ctx: RequestContext) {
  ctx.json(ctx.get('project'))
}
\`\`\`

Use \`defineContextDecorator\` (no Http prefix) only when the contributor must run across HTTP, WebSocket, queue, and cron transports — \`Ctx\` defaults to the smaller \`ExecutionContext\` surface (\`get\` / \`set\` / \`requestId\` only, no \`req\`).

**Five precedence levels** (high → low):
**method > class > module > adapter > global**

Same-key collisions WITHIN a precedence level throw \`DuplicateContributorError\`. Across levels, the higher precedence silently overrides — a feature, not a bug, but debug it by giving resolvers distinguishable return values.

**Boot-time validation**:
- Cycles in \`dependsOn\` → \`ContributorCycleError\`.
- \`dependsOn\` referring to an unknown key → \`MissingContributorError\`.
- Both errors fail boot, not first request.

**Critical rules — all stem from the same shared-via-ALS instance model**:
- Every per-request stage (middleware → contributors → handler) gets its OWN \`RequestContext\` instance, but they all read/write the SAME \`AsyncLocalStorage\`-backed bag.
- **\`resolve\` and \`onError\` must RETURN the value** — the runner writes it via \`ctx.set(key, value)\`. Direct property assignment (\`ctx.tenant = …\`) sticks to one instance only and the handler instance never sees it.
- \`ctx.set('tenant', x)\` then \`ctx.get('tenant')\` works across instances. \`ctx.req.headers[...]\` works (the underlying Express request is shared).
- Services with no \`ctx\` reference: \`getRequestValue('tenant')\` returns \`MetaValue<'tenant'> | undefined\` (typed via the augmented \`ContextMeta\`). For \`requestId\` use \`getRequestStore()\`.
- **No \`setRequestValue\` — writes flow through \`ctx.set\` or a contributor's return value.** Avoids "spooky action at a distance" where any service can pollute the per-request bag.

**Error matrix**:
- \`optional: true\` — \`resolve\` throws → key left unset; downstream sees \`ctx.get(key) === undefined\`.
- \`optional: false\` (default) + \`onError\` — return a fallback value to write; return \`undefined\` to skip; throw to forward to the request error handler.
- \`optional: false\` + no \`onError\` — throw propagates straight to the request error handler.

**Don't use this for**: response short-circuit, stream mutation, or pre-route-matching work — keep \`@Middleware()\` for those.

**Red flags**:
- \`ctx.tenant = x\` instead of returning the value from \`resolve\` — sticks to one instance only.
- \`defineAugmentation\` without the \`declare module\` block (or vice-versa) — discoverability and types drift apart; \`ctx.get('tenant')\` becomes \`unknown\`.
- Plugin / adapter authors using bare keys (\`'state'\`) instead of namespaced (\`'@my-plugin/state'\`) — collides with adopter keys.
- \`getRequestValue<string>('traceId')\` — generic is the **key** type, not value type.`,
    },
    {
      slug: 'query-parsing-list-endpoint',
      frontmatterName: 'kickjs-query-parsing-list-endpoint',
      description:
        'Use when adding a paginated/filterable list route — emit ctx.qs + ctx.paginate with an allow-list.',
      body: `**Canonical list endpoint**:

\`\`\`ts
@Get('/')
async list(ctx: Ctx<KickRoutes.TodoController['list']>) {
  const parsed = ctx.qs({
    filterable: ['status', 'priority', 'assigneeId'], // allow-list, MUST be set
    sortable: ['createdAt', 'updatedAt', 'priority'],
    searchColumns: ['title', 'description'], // free-text search targets
  })

  return ctx.paginate(async () => {
    const { data, total } = await this.service.list(parsed)
    return { data, total }
  }, parsed)
}
\`\`\`

**Operator format** (fixed): \`?filter=field:op:value\` where \`op ∈ eq | neq | gt | gte | lt | lte | between | in | contains | starts | ends\`. Sort is \`?sort=field:asc|desc\`. Only the first two colons are delimiters, so timestamps work (\`createdAt:gt:2026-01-01T00:00:00Z\`).

**Drizzle adopters** — pass a \`DrizzleQueryParamsConfig\` with column refs:

\`\`\`ts
const TASK_QUERY_CONFIG = {
  filterable: { status: tasks.status, priority: tasks.priority },
  sortable: { createdAt: tasks.createdAt },
  searchColumns: [tasks.title, tasks.description],
}
const parsed = ctx.qs(TASK_QUERY_CONFIG)
\`\`\`

**ORM-agnostic builders** — implement \`QueryBuilderAdapter<TResult, TConfig>\` with \`build(parsed, config)\`. The Drizzle + Prisma adapters live here.

**Red flags**:
- Reading \`req.query.status\` directly — bypasses the allow-list; opens unbounded filtering. Use \`ctx.qs({ filterable })\`.
- Omitting \`filterable\` / \`sortable\` allow-list — every client-supplied filter is **silently dropped** (security default, but looks like a bug).
- Hand-building the pagination meta in the controller — inconsistent response shape across endpoints. Always use \`ctx.paginate()\`.
- Returning a bare array from a list endpoint when pagination is implied — breaks the \`PaginatedResponse<T>\` contract.
- Mixing string \`searchable\` config with column \`searchColumns\` (Drizzle) — silently no-ops.

**Nuances**:
- \`limit\` is capped at 100 server-side; \`q\` (search) is truncated to 200 chars. Don't re-validate client-side.
- Sort direction defaults to \`asc\` when omitted (\`?sort=createdAt\` ≡ \`?sort=createdAt:asc\`).`,
    },
    {
      slug: 'use-asset-manager',
      frontmatterName: 'kickjs-use-asset-manager',
      description:
        'Use when code reads template files / JSON fixtures via fs.readFile + path arithmetic — switch to assets.<ns>.<key>() and the kick.config.ts assetMap.',
      body: `**Configure** \`kick.config.ts\`:

\`\`\`ts
export default defineConfig({
  assetMap: {
    mails: { src: 'src/templates/mails' },
    reports: { src: 'src/templates/reports', glob: '**/*.{ejs,html}' },
  },
})
\`\`\`

**Consume** via the typed Proxy — no \`__dirname\` arithmetic, dev/prod paths handled:

\`\`\`ts
import { assets } from '@forinda/kickjs'

const html = await assets.mails.welcome() // typed: tsc errors on bad key
\`\`\`

**Class-field decorator** (lazy getter, swappable in tests):

\`\`\`ts
class WelcomeMailService {
  @Asset('mails/welcome') private welcomeTemplate!: () => Promise<string>

  async send(to: string) {
    const body = await this.welcomeTemplate()
  }
}
\`\`\`

**Dynamic dispatch** (CMS templates, codegen) — \`resolveAsset(ns, key)\` throws \`UnknownAssetError\` with \`{ namespace, key }\` fields when the key is missing.

**Test fixtures** — swap via env override + cache clear:

\`\`\`ts
beforeEach(() => {
  process.env.KICK_ASSETS_ROOT = path.resolve('__fixtures__/assets')
  clearAssetCache()
})
afterEach(() => {
  delete process.env.KICK_ASSETS_ROOT
  clearAssetCache()
})
\`\`\`

**Red flags**:
- Hand-rolled \`process.env.NODE_ENV === 'production' ? join(__dirname, '../templates') : join(__dirname, 'templates')\` — exactly what the asset manager replaces.
- \`keys: 'strip'\` setting in \`assetMap.<ns>\` when basenames may collide — silent last-walk-wins data loss. Default \`'auto'\` keeps extensions only for colliding groups.
- Non-default Vite \`outDir\` without mirroring in \`kick.config.ts\` — manifest writes at \`dist/.kickjs-assets.json\` but the resolver can't find it. Mirror via \`build.outDir\`.
- Forgetting to re-run \`kick typegen\` after adding files — \`assets.mails.newTemplate\` is a tsc error even though the file ships. \`kick dev\` does this on-change; one-shot CI builds need \`kick build\` (or \`kick build:assets\` for manifest-only).
- Same-name \`welcome.ejs\` + \`welcome/login.ejs\` — directory wins in the typed surface; the \`.ejs\` file still copies but isn't addressable.

**Nuances**:
- Resolution pipeline (cached): \`KICK_ASSETS_ROOT\` env override > built manifest at \`build.outDir\` / \`dist\` / \`build\` / \`out\` > dev-fallback in-memory walk. Manifest presence = "running from built dist."
- Dev-mode glob matcher is a lite implementation — \`**/*\`, \`**/*.ext\`, \`**/*.{a,b}\` are guaranteed; exotic globs warn-once and accept everything. Run \`kick build:assets\` to exercise the real glob engine.`,
    },
    {
      slug: 'cli-commands-cheatsheet',
      frontmatterName: 'kickjs-cli-commands-cheatsheet',
      description:
        'Use as a quick reference for the most common kick CLI workflows — scaffolding, dev/build/start, generation, inspection.',
      body: `**Top commands**:
- \`kick new <name>\` — start a new project (prompts for template / repo / pm).
- \`kick dev\` — local dev server with Vite HMR.
- \`kick build\` — production bundle via Vite.
- \`kick start\` — run the built artifact (\`NODE_ENV=production\` auto-set).
- \`kick g module <name>\` — add a feature module; structure follows \`pattern\` in \`kick.config.ts\`.
- \`kick g scaffold <Name> <field:type>...\` — full CRUD module from field definitions.
- \`kick add <pkg>\` — install optional packages (auto-resolves peer deps + package manager).
- \`kick g --list\` — list every available generator (built-ins + plugin-shipped).
- \`kick info\` — environment / version dump for bug reports.
- \`kick inspect\` — introspect a running app: routes, middleware, adapters, DI graph.

**Useful flag combos**:

\`\`\`bash
kick new my-api --yes                                  # CI-safe: minimal + inmemory, no prompts
kick new my-api -t ddd --pm ${pm} --no-git --install   # Fully scriptable DDD scaffold
kick new . --yes --force                               # Scaffold into current dir, clear existing files
kick g scaffold Post title:string body:text:optional   # Shell-safe optional field syntax
kick g agents -f --only skills                         # Refresh just the skills after upgrade
kick add queue:bullmq                                  # Package + peer deps (bullmq + ioredis) in one shot
kick inspect --port 4000 --json                        # Machine-readable route/adapter dump
kick g config --force --repo drizzle                   # Drop a kick.config.ts into a legacy project
\`\`\`

**Lesser-known, high-value**:
- \`kick inspect --watch\` — live route/middleware/adapter table that re-renders on hot reload; faster than re-curling \`/_debug\`.
- \`kick g agents -f\` — regenerates \`CLAUDE.md\` (root) and \`.agents/AGENTS.md\` / \`GEMINI.md\` / \`COPILOT.md\` + every \`.agents/skills/<slug>/SKILL.md\` from the current CLI templates.
- \`kick dev:debug\` — same flags as \`kick dev\` but opens a Node inspector port for IDE attach.
- \`kick list --all\` (alias \`kick ls --all\`) — full optional-package catalog at this CLI version.
- \`kick typegen --watch\` — standalone typegen watcher when \`kick dev\` isn't running.
- \`kick check\` — preflight gate (typecheck + lint + format) before commit.
- \`kick codemod\` — automated AST-level migration between framework versions.

**Red flags**:
- Using globally-installed \`@forinda/kickjs-cli\` while contributing to the monorepo — \`pnpm link --global\` from \`packages/cli\` so generators match the framework.
- Writing \`"name:type?"\` for optional scaffold fields — \`?\` is a shell glob in bash/zsh; use \`name:type:optional\`.
- Running \`kick new <name> --yes\` in a non-empty directory expecting it to wipe — \`--yes\` aborts without \`--force\`; pair them when destruction is intended.
- Skipping \`kick g config\` on a legacy project then wondering why generators ignore \`modules.dir\` / \`modules.repo\`.
- Editing \`kick.config.ts\` with deprecated top-level \`modulesDir\` / \`defaultRepo\` / \`schemaDir\` / \`pluralize\` instead of the nested \`modules\` block.`,
    },
    {
      slug: 'refresh-agent-docs',
      frontmatterName: 'kickjs-refresh-agent-docs',
      description:
        'Use after a KickJS version bump to sync the .agents/ docs with the latest CLI templates.',
      body: `**Steps**:
1. \`kick g agents -f --only both\` — overwrites \`CLAUDE.md\` (root) and \`.agents/AGENTS.md\`.
2. \`kick g agents -f --only skills\` — refreshes every \`.agents/skills/<slug>/SKILL.md\`.
3. \`kick g agents -f --only gemini\` / \`--only copilot\` — refresh the per-agent files when needed.
4. Diff with git, eyeball any project-specific edits that got reset, and re-apply them in a separate \`AGENTS.local.md\` or per-skill \`SKILL.local.md\` alongside.
5. Commit as \`docs(agents): sync from CLI vX.Y\`.

**\`.agents/\` layout** (post-restructure):

\`\`\`
CLAUDE.md                 # at root — Claude Code auto-loads from here
.agents/
├── AGENTS.md             # canonical multi-agent reference
├── GEMINI.md             # Gemini-specific notes
├── COPILOT.md            # Copilot CLI notes
└── skills/
    ├── add-module/SKILL.md
    ├── add-adapter/SKILL.md
    └── …                 # one SKILL.md per skill, frontmatter-namespaced
\`\`\`

Customisation goes in \`.local.md\` siblings (\`AGENTS.local.md\`, \`skills/<slug>/SKILL.local.md\`) — those are never overwritten.`,
    },
    {
      slug: 'deny-list',
      frontmatterName: 'kickjs-deny-list',
      description:
        'Patterns to refuse outright when the user asks for them — they break v4 invariants.',
      body: `**Module / adapter / plugin shape**:
- \`class implements AppAdapter\` → use \`defineAdapter()\`.
- \`class implements KickPlugin\` / function returning \`KickPlugin\` → use \`definePlugin()\`.
- \`class implements AppModule\` for new code → use \`defineModule()\`.
- \`bootstrap({ adapters: [MyAdapter] })\` (factory) → \`MyAdapter()\` (instance, with parens).
- \`@Controller('/path')\` with a path argument → drop the path; set the mount via \`routes().path\`. The decorator path is OpenAPI metadata only.
- Module file named \`<name>.ts\` (no \`.module\` suffix) → rename to \`<name>.module.ts\`. Vite HMR's glob doesn't pick up the unsuffixed form.

**DI**:
- \`new Container()\` or \`Container.getInstance().reset()\` in tests → use \`Container.reset()\` in \`beforeEach\` (or \`Container.create()\` for fully isolated graphs).
- DI tokens with \`:\` separator (\`'app:db:url'\`) or in PascalCase → use slash-delimited lower-case (\`'app/db/url'\`). First-party uses reserved \`'kick/'\` prefix.
- \`Symbol.for(...)\` for DI tokens — globally interned, **collides across files**. Use \`createToken<T>('name')\`.
- Raw string tokens (\`@Inject('config')\`) — silent collisions; widens to \`unknown\`. Use \`createToken<T>\`.
- Injecting a \`Scope.REQUEST\` service into a \`SINGLETON\` — container throws at resolve time.

**Bootstrap / entry file**:
- \`bootstrap({ ... })\` without \`export const app = ...\` → always export. HMR degrades to full restart and \`createTestApp\` loses the handle.
- \`bootstrap({ register: ... })\` — that option doesn't exist. Use an inline plugin in \`plugins\`.

**Middleware**:
- Using \`(ctx, next)\` for global middleware in \`bootstrap({ middleware })\` — global middleware uses raw Express \`(req, res, next)\`. Wrong signature throws "Cannot read properties of undefined".
- Using \`(req, res, next)\` for an \`@Middleware()\` decorator — those use \`(ctx, next)\`.
- \`@Middleware()\` whose only output is \`ctx.set('x', v)\` — should be a context decorator (typed, ordered, testable).

**Context contributors**:
- \`ctx.tenant = x\` from a contributor — only sticks to one \`RequestContext\` instance. **Return the value** so the runner writes it via \`ctx.set(key, value)\`.
- \`defineAugmentation('ContextMeta', ...)\` without the matching \`declare module '@forinda/kickjs'\` block (or vice-versa).
- \`getRequestValue<string>('traceId')\` — generic is the **key** type, not value type.

**Env / config**:
- \`@Value('NEW_KEY')\` without the key in the Zod schema — silent fallback to raw \`process.env\`, no coercion.
- \`resetEnvCache()\` outside tests — drops the registered schema.

**List endpoints**:
- Reading \`req.query.status\` directly — bypasses the allow-list. Use \`ctx.qs({ filterable })\`.
- Returning a bare array from a list endpoint — breaks the \`PaginatedResponse<T>\` contract. Use \`ctx.paginate()\`.

**Assets**:
- Hand-rolled \`__dirname\` arithmetic for template paths — use \`assets.<ns>.<key>()\` and add the namespace to \`kick.config.ts assetMap\`.`,
    },
  ]

  return skills.map((skill) => ({
    slug: skill.slug,
    content: `---
name: ${skill.frontmatterName}
description: ${skill.description}
---

${banner}

${skill.body}
`,
  }))
}

/**
 * @deprecated Kept only for back-compat with adopters who programmatically
 * import this function from `@forinda/kickjs-cli`. The CLI itself no
 * longer calls it — `kick g agents` emits per-skill SKILL.md files via
 * {@link generateKickJsSkillFiles}. Will be removed in a future minor.
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
// src/modules/index.ts — fluent chain (default for \`modules.style: 'define'\`)
export const modules = defineModules().mount(HelloModule()).mount(UsersModule())
// OR for class-form projects (\`modules.style: 'class'\`):
//   export const modules: AppModuleEntry[] = [HelloModule, UsersModule]

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

- [KickJS Docs](https://kickjs.app/)
- [Decorators](https://kickjs.app/guide/decorators.html)
- [Context Decorators](https://kickjs.app/guide/context-decorators.html)
- [Testing](https://kickjs.app/api/testing.html)
`
}

/**
 * Render the Gemini-specific agent file emitted at
 * `.agents/GEMINI.md`. Gemini CLI loads files matching its own
 * convention; this file pairs a pointer to the shared
 * `.agents/AGENTS.md` with notes specific to Gemini's tool surface
 * (activate_skill, sandboxed file ops, etc.). Adopters who don't use
 * Gemini can delete this file safely — the generator emits it as a
 * starting point, not a requirement.
 */
export function generateGemini(name: string, _template: ProjectTemplate, _pm: string): string {
  return `# GEMINI.md — ${name}

**Read \`./AGENTS.md\` first.** It is the canonical, multi-agent
reference for this project — every convention, structure, decorator
pattern, env wiring rule, generator usage. This file is a thin
Gemini-specific layer; when the two disagree on anything substantive,
treat \`AGENTS.md\` as authoritative and flag the discrepancy.

## Why this file

Gemini CLI auto-loads \`GEMINI.md\` when it lives alongside the
agent-context files. Keeping it in \`.agents/\` next to \`AGENTS.md\`
means Gemini reads the same shared prose as Codex / Cursor / Copilot
without us copy-pasting.

## Gemini-specific notes

- **Skills activation** — Gemini activates skills via
  \`activate_skill\` (its native MCP-style tool); the equivalent on
  Claude Code is the \`Skill\` tool. Cross-reference the
  \`kickjs-skills.md\` index for the available triggers.
- **Tool naming** — Gemini's tool names differ from Claude Code's
  (e.g. \`read_file\` vs \`Read\`, \`run_terminal_command\` vs
  \`Bash\`). The shared prose in \`AGENTS.md\` describes intents, not
  tool names; consult Gemini's docs for the concrete invocation.
- **File ops** — Gemini's file edits are sandboxed; large refactors
  may need explicit confirmation. Prefer the smallest-possible-edit
  pattern.

## Refreshing this file

\`kick g agents --only gemini -f\` regenerates this file from the
CLI template. Hand-edited content is overwritten — keep customisation
in \`.agents/GEMINI.local.md\`.
`
}

/**
 * Render the GitHub Copilot CLI agent file emitted at
 * `.agents/COPILOT.md`. Same pattern as `generateGemini` — thin
 * pointer to `.agents/AGENTS.md` with notes specific to Copilot
 * CLI's tool surface and conventions.
 */
export function generateCopilot(name: string, _template: ProjectTemplate, _pm: string): string {
  return `# COPILOT.md — ${name}

**Read \`./AGENTS.md\` first.** It is the canonical, multi-agent
reference for this project — every convention, structure, decorator
pattern, env wiring rule, generator usage. This file is a thin
Copilot-specific layer; when the two disagree on anything substantive,
treat \`AGENTS.md\` as authoritative and flag the discrepancy.

## Why this file

GitHub Copilot CLI auto-loads \`COPILOT.md\` when it lives alongside
the agent-context files. Keeping it in \`.agents/\` next to
\`AGENTS.md\` means Copilot reads the same shared prose as
Codex / Cursor / Gemini / Claude Code without copy-pasting.

## Copilot-specific notes

- **Skills** — Copilot CLI auto-discovers skills from installed
  plugins; cross-reference \`kickjs-skills.md\` for available
  triggers in this project.
- **Tool naming** — Copilot's tool names differ from Claude Code's
  (\`edit\` vs \`Edit\`, \`shell\` vs \`Bash\`, etc.). The shared
  prose in \`AGENTS.md\` describes intents, not tool names; consult
  Copilot's docs for the concrete invocation.
- **Confirmation flows** — Copilot CLI surfaces destructive
  operations through an explicit approval gate. Stage edits with
  short, focused diffs so each one is easy to review at the prompt.

## Refreshing this file

\`kick g agents --only copilot -f\` regenerates this file from the
CLI template. Hand-edited content is overwritten — keep customisation
in \`.agents/COPILOT.local.md\`.
`
}
