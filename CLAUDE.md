# CLAUDE.md — KickJS Development Guide

> **Read [`AGENTS.md`](./AGENTS.md) first.** It is the canonical, multi-agent
> reference for this monorepo (Claude, Copilot, Codex, Gemini, etc.). This
> file mirrors the same project context distilled for Claude, plus
> Claude-specific notes. When the two disagree on anything substantive, treat
> `AGENTS.md` as authoritative and flag the discrepancy.

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
examples/                       # Non-published example apps (private, not on npm)
  minimal-api/                  # Simplest possible app (~10 lines)
  task-drizzle-api/             # Full task management app — PostgreSQL + Drizzle
  task-mongoose-api/            # Full task management app — MongoDB + Mongoose
  task-prisma-api/              # Full task management app — PostgreSQL + Prisma 7
  multi-tenant-drizzle-api/     # Multi-tenant pattern — PostgreSQL + Drizzle
  multi-tenant-mongoose-api/    # Multi-tenant pattern — MongoDB + Mongoose
  multi-tenant-prisma-api/      # Multi-tenant pattern — PostgreSQL + Prisma
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

Implement `AppAdapter` from `@forinda/kickjs/adapter`:

- `name: string`
- `beforeMount?({ app }: AdapterContext)`, `beforeStart?({ container }: AdapterContext)`, `afterStart?({ server }: AdapterContext)`
- `shutdown?(): Promise<void>`
- `middleware?(): AdapterMiddleware[]`

### Adding an Example App

Use the built CLI to scaffold — never create files manually.

```bash
# 1. Build CLI first (if not already built)
pnpm build

# 2. Scaffold from examples/ directory (all flags required to avoid interactive prompts)
cd examples
node ../packages/cli/bin.js new my-example-api \
  --template minimal --pm pnpm --repo inmemory --no-git --no-install --force
```

Available flags: `--template rest|graphql|ddd|cqrs|minimal`, `--pm pnpm|npm|yarn`, `--repo prisma|drizzle|inmemory|custom`, `--no-git`, `--no-install`, `--force`.

3. Update generated `package.json`:
   - Rename to `@forinda/kickjs-example-<name>`
   - Set `"private": true`
   - Replace published `@forinda/kickjs*` deps with `workspace:*` references
4. `pnpm-workspace.yaml` already includes `examples/*` — no change needed
5. Add row to Example Apps table in `README.md`
6. Run `pnpm install && pnpm build` from root to verify

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

### Context Contributors (#107)

Typed, ordered, declarative way to populate `ctx.set('key', value)` before a handler runs. Use this **instead of `@Middleware()`** when the only job is to compute a value other code reads off `ctx`.

```ts
const LoadTenant = defineContextDecorator({
  key: 'tenant',
  deps: { repo: TENANT_REPO },              // typed DI
  resolve: (ctx, { repo }) => repo.findById(ctx.req.headers['x-tenant-id'] as string),
})

const LoadProject = defineContextDecorator({
  key: 'project',
  dependsOn: ['tenant'],                    // topo-sorted at startup; cycles fail boot
  resolve: (ctx) => projectsRepo.find(ctx.get('tenant')!.id, ctx.params.id),
})

@LoadTenant
@LoadProject
@Get('/projects/:id')
getProject(ctx: RequestContext) { ctx.json(ctx.get('project')) }
```

Five registration sites, precedence high→low: **method > class > module > adapter > global**. Apply via `@`-decorator (method/class), `AppModule.contributors?()`, `AppAdapter.contributors?()`, or `bootstrap({ contributors })`. Full guide at `docs/guide/context-decorators.md`. Do NOT use this for short-circuiting responses, response-stream mutation, or pre-route-matching middleware — keep using `@Middleware()` / global middleware for those.

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
import { bootstrap, helmet, cors, requestId, requestLogger, csrf, rateLimit } from '@forinda/kickjs'

bootstrap({
  modules: [
    /* your modules */
  ],
  middleware: [
    helmet(), // Security headers (X-Frame-Options, HSTS, etc.)
    cors({ origin: ['https://app.example.com'] }), // CORS with spec-correct behavior
    requestId(), // X-Request-Id generation/propagation
    requestLogger(), // Pino-based request logging (method, URL, status, duration)
    csrf(), // CSRF protection (double-submit cookie)
    rateLimit(), // Rate limiting with pluggable store
    express.json(), // Body parsing
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
  pascal: string // PascalCase name
  kebab: string // kebab-case name
  plural?: string // Pluralized kebab
  pluralPascal?: string // Pluralized Pascal
  repoPrefix?: string // Repository import prefix
  dtoPrefix?: string // DTO import prefix
  prismaClientPath?: string
  repoType?: string // Custom repo type name
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
- **Env wiring**: `src/env.ts` must call `loadEnv(envSchema)` as a side effect AND be imported from `src/index.ts` (`import './env'`) before `bootstrap()` runs. Otherwise `ConfigService.get('CUSTOM_KEY')` returns `undefined` while `@Value('CUSTOM_KEY')` _appears_ to work via its `process.env` fallback. The CLI generators wire both halves automatically; manual upgrades must add both. See `docs/guide/configuration.md#wiring-the-schema-at-startup`.
