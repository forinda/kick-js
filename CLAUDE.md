# CLAUDE.md — KickJS Development Guide

## Project Overview

KickJS is a decorator-driven Node.js framework built on Express 5 and TypeScript. Monorepo managed with pnpm workspaces and Turbo.

**18 published packages** under `@forinda/kickjs-*`, **10 example apps**, CLI with generators, Prisma/Drizzle/custom ORM support.

## Quick Commands

```bash
pnpm build              # Build all packages
pnpm test               # Run all tests
pnpm format             # Fix formatting
pnpm format:check       # Check formatting
pnpm docs:dev           # Dev docs server
pnpm docs:build         # Build docs
pnpm release:dry        # Dry run release
```

## Repository Structure

```
packages/               # Published @forinda/kickjs-* packages
  core/                 # DI container, 20+ decorators, module system, logger, reactivity
  http/                 # Express 5, routing, middleware, RequestContext, query parsing
  config/               # Zod-based env validation, ConfigService, @Value decorator
  cli/                  # Project scaffolding, DDD generators, kick add, kick remove
  swagger/              # OpenAPI spec generation from decorators
  testing/              # createTestApp, createTestModule helpers
  prisma/               # Prisma adapter (v5/6/7), PrismaModelDelegate, query building
  drizzle/              # Drizzle adapter, DrizzleQueryAdapter
  auth/                 # JWT, API key, OAuth strategies, @Public, @Roles
  ws/                   # WebSocket with @WsController, rooms, heartbeat
  queue/                # BullMQ/RabbitMQ/Kafka with @Job, @Process
  cron/                 # Cron scheduling with @Cron decorator
  mailer/               # SMTP, Resend, SES, ConsoleProvider
  graphql/              # @Resolver, @Query, @Mutation, GraphiQL
  otel/                 # OpenTelemetry tracing and metrics
  devtools/             # Debug dashboard at /_debug
  notifications/        # Multi-channel: email, Slack, Discord, webhook
  multi-tenant/         # Tenant resolution middleware
examples/               # Non-published example apps (private, not on npm)
  jira-drizzle-api/     # Full Jira clone — PostgreSQL + Drizzle ORM
  jira-mongoose-api/    # Full Jira clone — MongoDB + Mongoose
  jira-prisma-api/      # Full Jira clone — PostgreSQL + Prisma 6
  jira-prisma-v7-api/   # Full Jira clone — PostgreSQL + Prisma 7 (driver adapters)
  minimal-api/          # Simplest possible app (~10 lines)
  graphql-api/          # GraphQL with @Resolver decorators
  devtools-api/         # DevTools dashboard + reactive state
  joi-api/              # Custom Joi schema parser for Swagger
  microservice-api/     # OTel + DevTools + Swagger template
  otel-api/             # OpenTelemetry console tracing
articles/               # Blog articles (dev.to)
scripts/                # release.js (versioning)
docs/                   # VitePress documentation site
```

## Package Manager & Build

- **pnpm** — always use `pnpm`, never npm/yarn
- **Turbo** — orchestrates builds with dependency-aware caching
- **Vite 8** — builds each package in library mode (ESM, esbuild minify, node20 target)
- **tsc** — generates `.d.ts` via `tsconfig.build.json` (`emitDeclarationOnly`)
- **Vitest** — test runner with SWC for decorator support

## Code Style

- **Prettier** — no semicolons, single quotes, trailing commas, 100 char width
- **No ESLint** — relies on TypeScript strict mode + Prettier
- **Pre-commit hook** — runs `build → test → format:check` via husky
- Format before committing: `pnpm format`

## Key Patterns

### Adding Middleware (to `packages/http`)

1. Create `packages/http/src/middleware/<name>.ts`
2. Add entry to `packages/http/vite.config.ts` `build.lib.entry` object
3. Add export map entry to `packages/http/package.json`
4. Add re-export to `packages/http/src/index.ts`

### Adding a Package

1. Create `packages/<name>/` with `package.json`, `tsconfig.json`, `tsconfig.build.json`, `vite.config.ts`
2. Name it `@forinda/kickjs-<name>`, use lockstep version
3. Use `workspace:*` for internal deps
4. Set `minify: 'esbuild'` in vite.config.ts, add all runtime deps to `rollupOptions.external`
5. Build script: `"build": "vite build && pnpm build:types"`, `"build:types": "tsc -p tsconfig.build.json"`

### Adding an Adapter

Implement `AppAdapter` from `@forinda/kickjs-core/adapter`:
- `name: string`
- `beforeMount?({ app }: AdapterContext)`, `beforeStart?({ container }: AdapterContext)`, `afterStart?({ server }: AdapterContext)`
- `shutdown?(): Promise<void>`
- `middleware?(): AdapterMiddleware[]`

### Decorators

```ts
@Controller('/path')       // Route prefix
@Get('/'), @Post('/'), @Put('/'), @Delete('/'), @Patch('/')
@Service()                 // DI-registered singleton
@Repository()              // DI-registered singleton (semantic)
@Autowired()               // Property injection
@Inject('token')           // Token-based injection
@Value('ENV_VAR')          // Config value injection
@Middleware(fn)            // Attach middleware
@Public()                  // Opt out of auth
@Roles('admin')            // Role-based access
@Cron('0 * * * *')        // Cron schedule
```

### RequestContext

Every controller method receives `ctx: RequestContext` with:
- `ctx.body`, `ctx.params`, `ctx.query`, `ctx.headers`
- `ctx.requestId`, `ctx.session`, `ctx.file`, `ctx.files`
- `ctx.qs(fieldConfig)` — parsed query with filters/sort/pagination
- `ctx.paginate(handler, config)` — auto-paginated response
- `ctx.json(data)`, `ctx.created(data)`, `ctx.noContent()`, `ctx.notFound()`

### Built-in Middleware

```ts
import express from 'express'
import { bootstrap, helmet, cors, requestId, requestLogger, csrf, rateLimit } from '@forinda/kickjs-http'

bootstrap({
  modules: [/* your modules */],
  middleware: [
    helmet(),           // Security headers (X-Frame-Options, HSTS, etc.)
    cors({ origin: ['https://app.example.com'] }),  // CORS with spec-correct behavior
    requestId(),        // X-Request-Id generation/propagation
    requestLogger(),    // Pino-based request logging (method, URL, status, duration)
    csrf(),             // CSRF protection (double-submit cookie)
    rateLimit(),        // Rate limiting with pluggable store
    express.json(),     // Body parsing
  ],
})
```

Also available: `validate()` (Zod body/query/params), `upload()` (multer file handling), `session()` (cookie sessions).

### Git Workflow

Use feature branches — never commit directly to `main` or `dev`:
- **Stable work** → branch from `main`, PR to `main`
- **Experimental work** → branch from `dev`, PR to `dev`
- **Promote** → PR `dev` → `main` when stable

```bash
git checkout main && git pull origin main
git checkout -b feat/my-feature
# ... make changes ...
git commit -m "feat: description (#issue)"
git push -u origin feat/my-feature
gh pr create --base main
```

## CLI Architecture

The CLI (`packages/cli/`) is structured as:

```
src/
  cli.ts                          # Entry point, registers all commands
  config.ts                       # KickConfig, ModuleConfig, defineConfig, resolveModuleConfig
  commands/
    generate.ts                   # kick g module/controller/service/...
    remove.ts                     # kick rm module
    init.ts                       # kick new
    run.ts                        # kick dev/build/start
    add.ts                        # kick add <package>
  generators/
    module.ts                     # generateModule orchestrator
    remove-module.ts              # removeModule + index.ts cleanup
    patterns/                     # Pattern-specific generators
      rest.ts, ddd.ts, cqrs.ts, minimal.ts
      types.ts                    # ModuleContext interface
    templates/                    # Code template functions
      types.ts                    # TemplateContext interface
      repository.ts               # inmemory + custom repo generators
      drizzle/index.ts            # Drizzle-specific templates
      prisma/index.ts             # Prisma-specific templates
      controller.ts, dtos.ts, domain.ts, ...
```

### Key CLI Config (kick.config.ts)

```ts
export default defineConfig({
  pattern: 'ddd',
  modules: {
    dir: 'src/modules',
    repo: 'prisma',                     // 'drizzle' | 'inmemory' | 'prisma' | { name: 'custom' }
    pluralize: true,
    schemaDir: 'prisma/',
    prismaClientPath: '@/generated/prisma/client',  // Prisma 7
  },
  commands: [...],
})
```

### Template Functions

All template generators accept `TemplateContext`:
```ts
interface TemplateContext {
  pascal: string          // PascalCase name
  kebab: string           // kebab-case name
  plural?: string         // Pluralized kebab
  pluralPascal?: string   // Pluralized Pascal
  repoPrefix?: string     // Repository import prefix
  dtoPrefix?: string      // DTO import prefix
  prismaClientPath?: string
  repoType?: string       // Custom repo type name
}
```

## Prisma Adapter

- `PrismaAdapter` — registers client in DI, supports Prisma 5/6/7
- `PrismaModelDelegate` — typed CRUD interface for cast-free repos
- `PrismaQueryAdapter` — translates ParsedQuery to findMany args
- `PrismaQueryConfig<TModel>` — generic validates searchColumns against model fields
- Logging: `$on` for v5/6, `$extends` for v7 (auto-detected)

## Linking the CLI Locally

```bash
pnpm build
cd packages/cli && pnpm link --global
```

Now `kick` uses your latest local code. After changes, just `pnpm build` — no re-link needed.

## Testing

- Tests live in `tests/` at root and `packages/*/src/**/*.test.ts`
- Use `Container.reset()` in `beforeEach` to isolate DI state
- Run: `pnpm test`

## Releasing

All packages use **lockstep versioning**. Never bump individually.

```bash
pnpm release:patch                  # 1.2.13 → 1.2.14
pnpm release:minor                  # 1.2.13 → 1.3.0
pnpm release:patch:gh               # With GitHub release
pnpm release:dry                    # Preview only
```

The release script bumps all package.json files (packages + examples), generates changelog, snapshots docs, commits, tags, pushes, and publishes.

## CI/CD

- **ci.yml** — build, typecheck, test, format on push to main/dev and PRs
- **deploy-docs.yml** — build and deploy VitePress on push to main
- **release.yml** — verify and publish on version tags

## Commit Conventions

```
feat: description      # New feature → minor bump
fix: description       # Bug fix → patch bump
docs: description      # Documentation only
chore: description     # Maintenance
refactor: description  # Code restructuring
ci: description        # CI/CD changes
test: description      # Test changes
```

## Important Notes

- Decorators fire at class definition time — tests need `Container.reset()` + re-registration
- `pnpm --filter='./packages/*' publish` — only publishes framework packages, not examples
- All internal links in docs must be **relative** (for versioning/i18n support)
- The `kick` CLI binary comes from `packages/cli/src/cli.ts`
- Vite configs: `minify: 'esbuild'`, all runtime deps in `rollupOptions.external`
- `@prisma/client` peer dep is optional (Prisma 7 generates client locally)
- Old top-level config fields (`modulesDir`, `defaultRepo`, etc.) are deprecated — use `modules` block
