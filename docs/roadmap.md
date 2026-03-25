# Roadmap

## v1.x — Planned

- [x] `@Cron` scheduler — `@forinda/kickjs-cron` with pluggable CronScheduler (croner, interval, custom)
- [x] `@Cacheable` decorator — pluggable CacheProvider (memory default, Redis, custom)
- [x] Auth plugin — `@forinda/kickjs-auth` with JWT, API key, and custom strategies
- [x] `kick g scaffold` — generate full CRUD module from field definitions
- [x] `kick tinker` — REPL with DI container loaded
- [x] SPA integration — `SpaAdapter` serves Vue/React/Svelte builds alongside API
- [x] Mailer adapter — `@forinda/kickjs-mailer` with pluggable MailProvider (SMTP, Resend, SES, custom)
- [x] Queue monitoring in DevTools dashboard — `/_debug/queues` tab with job counts
- [x] Notification system — `@forinda/kickjs-notifications` with email, Slack, Discord, webhook
- [x] Extensible `defaultRepo` — custom ORM support via `{ name: 'typeorm' }` config
- [x] Working Prisma CLI template — `kick g module --repo prisma` generates real Prisma code
- [x] `--no-pluralize` — configurable pluralization for module generators
- [x] `modules` config block — grouped generation settings with backward compat

## v1.2.14 — Next

### CLI
- [x] Validate `modules.repo` at config load time — warn if value doesn't match a known built-in pattern (KICK-024)

### Prisma Adapter
- [x] `PrismaQueryAdapter` type-safe `searchColumns` — accept Prisma model field names via generics instead of plain strings (KICK-025)

### Examples
- [x] Verify `jira-prisma-api` compiles against Prisma schema — run `prisma generate` + `tsc --noEmit` to catch type mismatches (KICK-026)

### Prisma 7 Compatibility (KICK-027)
Prisma 7 introduces several breaking changes that affect `@forinda/kickjs-prisma` and the `jira-prisma-api` example:

- [x] **PrismaAdapter: support driver adapters** — Logging now uses `$extends` fallback when `$on` is unavailable (Prisma 7). `PrismaAdapterOptions.client` is `any`-typed, already version-agnostic.
- [x] **Import path change** — `jira-prisma-v7-api` uses `@/generated/prisma/client`. CLI template includes a Prisma 7 import note.
- [x] **Schema generator update** — v7 example uses `provider = "prisma-client"` with `output` field + `prisma.config.ts`.
- [x] **Remove middleware usage** — No `$use()` calls in adapter. Logging uses `$extends` for Prisma 7+.
- [x] **Env loading** — v7 example uses `dotenv/config` in `prisma.config.ts`. `@forinda/kickjs-config` loads env before app bootstrap.
- [x] **jira-prisma-v7-api example** — Full v7 migration: driver adapters, generated client path, prisma.config.ts, 47 files updated.
- [x] **Peer dependency range** — `@prisma/client` marked optional in `peerDependenciesMeta` for Prisma 7 users.

### CLI
- [x] Configurable Prisma generated client path in `modules` config — `modules.prismaClientPath` controls the import in `--repo prisma` templates (KICK-029)

### Code Quality
- [x] Remove `any` casts in jira-prisma-v7-api repositories — typed relation results with Prisma model types, removed unnecessary field access casts (KICK-028)
- [x] Refactor CLI generators: use option objects (`TemplateContext`), split patterns into `patterns/` folder, group ORM templates in `templates/drizzle/` and `templates/prisma/` (KICK-030)

### CLI
- [ ] `kick add prisma` should scaffold `prisma/schema.prisma` + `prisma.config.ts` (v7). `kick add drizzle` should scaffold `drizzle.config.ts` + `src/db/schema/` (KICK-032)
- [ ] `kick new` should generate a project-level `CLAUDE.md` with framework context, wiring patterns, and available commands for AI-assisted development (KICK-033)

### Future
- [x] `kick remove module <name>` — delete module directory and unregister from `src/modules/index.ts` (KICK-031)
### Vite Environment Migration (KICK-034)
Migrate from `vite-node` (deprecated) to Vite's native `RunnableDevEnvironment` API. This unlocks a unified dev server architecture:

- [x] **Replace `vite-node` in `kick dev`** — uses `createServer()` + `RunnableDevEnvironment.runner.import()`. Removed `vite-node` from all examples and project template.
- [x] **`kick dev:debug`** — uses `NODE_OPTIONS=--inspect` with programmatic Vite server.
- [x] **Remove `vite-node`** — removed from project template, all 10 examples. CLI resolves `vite` from the user's project via `createRequire`.
- [ ] **Unified backend + frontend dev server** — run KickJS API (`server` environment) and SPA frontend (`client` environment) in the same Vite instance with shared HMR. One port, one process, no proxy needed.
- [ ] **`kick dev --spa <dir>`** — serve a Vue/React/Svelte app alongside the API. The SPA gets Vite's native HMR; the API gets KickJS's `Application.rebuild()` HMR.

**Verified:** SWC decorator transforms, HMR rebuild (`Application.rebuild()`), and graceful shutdown all work through the Vite Environment Runner.

See: [Migration notes](../articles/vite-node-migration-notes.md) | [Vite Environment API](https://vite.dev/guide/api-environment-frameworks)

### Future
- [ ] Type-safe API client generation (tRPC-like) — `kick generate:client` from route decorators + Zod DTOs (KICK-018)
- [ ] `kick deploy` — deploy to Fly.io, Railway, Docker

## v1.2.13 — CLI Extensibility & Bundle Optimization

### Features
- [x] **Extensible `defaultRepo`** — accepts built-in strings (`'drizzle'`, `'prisma'`, `'inmemory'`) or custom objects (`{ name: 'typeorm' }`) for any ORM
- [x] **Working Prisma template** — `kick g module --repo prisma` generates fully functional Prisma Client code with `@Inject(PRISMA_CLIENT)`
- [x] **`--no-pluralize` flag** — skip auto-pluralization for module folders and routes, also configurable via `modules.pluralize: false`
- [x] **`modules` config block** — grouped `dir`, `repo`, `pluralize`, `schemaDir` under `modules` key; old top-level fields deprecated with backward compat
- [x] **Custom repo types** — any string generates a stub repository with correct naming (e.g. `TypeormUserRepository`)
- [x] **Dynamic module comments** — generated JSDoc reflects actual repo type instead of hardcoding "Drizzle"

### Bundle Size Optimization
- [x] Disabled sourcemaps and enabled minification across all 18 packages
- [x] Fixed missing externals (express, pino, zod, multer, commander, dotenv) — testing package dropped from 2.7MB to 12KB
- [x] Bundle size table added to root README

### Examples
- [x] Added `jira-prisma-api` — full Jira clone with Prisma ORM (14 DDD modules, 17 Prisma models)
- [x] Bumped `jira-drizzle-api` and `jira-mongoose-api` from v1.2.10 to v1.2.13
- [x] Release script now bumps example versions (cleaned up deleted examples from EXAMPLES list)

### Documentation
- [x] Removed 7 orphaned example doc pages (basic-api, auth-api, validated-api, full-api, ws-api, sse-api, queue-api)
- [x] Created docs for jira-drizzle-api, jira-prisma-api, jira-mongoose-api, joi-api
- [x] Added READMEs for 11 packages (ws, drizzle, otel, graphql, auth, cron, mailer, queue, multi-tenant, devtools, notifications)
- [x] Added `kick add` CLI install instructions to all 18 package READMEs
- [x] Fixed `ctx: any` to `RequestContext` in core README
- [x] Updated all docs to use new `modules` config block

## v1.2.x — Resolved Issues

### Bug Fixes
- [x] Modules without routes crash Express — return `null` from `routes()` (KICK-003)
- [x] `defineEnv`/`loadEnv` loses Zod schema types — schema type preserved through chain (KICK-004)
- [x] Controller path doubled in route mounting — `@Controller` path is metadata only, not routing (KICK-007)
- [x] `ctx.set()`/`ctx.get()` not shared between middleware and handler — metadata Map stored on `req` (KICK-009)
- [x] `@Public()` not respected — auth middleware matches by path pattern, not `req.route` (KICK-010)
- [x] `@Inject` on properties causes TS1240 — documented as constructor-only, use `@Autowired(token)` for properties (KICK-011)
- [x] Nodemailer peer dep mismatch — widened to `>=6.0.0` (KICK-002)
- [x] `QueryParamsConfig` type name mismatch in docs — added re-export alias (KICK-014)
- [x] `@Job` classes not auto-registered in DI — QueueAdapter registers before resolving (KICK-016)
- [x] Decorator `containerRef` stale after `Container.reset()` — `_onReset` callback updates ref (KICK-017)
- [x] DI bindings lost on HMR — class name fallback key + persistent decorator registry (KICK-013)
- [x] DevTools peers lost on HMR — discover adapters at request time from app registry (KICK-012)
- [x] Double-slash routes (`/api/v1//projects`) — normalize module path before mounting (KICK-007)
- [x] `vite/client` missing in generated tsconfig — `kick new` includes it by default (KICK-019)

### Enhancements
- [x] `DrizzleQueryAdapter.buildFromColumns()` — type-safe Column-based query building with `baseCondition`, smart type coercion, native `between` (KICK-020)
- [x] `DrizzleQueryParamsConfig` type exported from `@forinda/kickjs-drizzle` (KICK-022)
- [x] CLI generates `DrizzleQueryParamsConfig` when `--repo drizzle` (KICK-021)
- [x] `@ApiQueryParams` and `ctx.paginate` accept both string-based and column-object configs (KICK-023)
- [x] `kick new` generates README.md (KICK-015)
- [x] `kick new` supports `--template` flag for CI/scriptable usage (KICK-001)

### Documentation
- [x] Config guide: `defineEnv` + `createConfigService` patterns (KICK-004)
- [x] Queue docs: fixed `QueueAdapterOptions.queues` type (KICK-005)
- [x] MongoDB guide: HMR-safe Mongoose model pattern (KICK-006)
- [x] Middleware guide: global vs route handler signature difference (KICK-008)
- [x] Benchmarks guide: rewritten for user apps, not monorepo (KICK-016)
- [x] Query parsing guide: column-object config support
- [x] Decorators guide: `@ApiQueryParams` accepts Drizzle configs

### Community / Tutorial Patterns

These are ORM/DB-specific. We provide tutorials in the [Custom Decorators Guide](./guide/custom-decorators.md) showing how to build them:

- `@Transactional` — each ORM has its own transaction API
- `@BeforeSave` / `@AfterCreate` — ORM lifecycle hooks
- Query scopes — depends on the query builder
- Custom queue providers — `QueueProvider` interface for any backend

## v1.0.0 — Shipped

- [x] **16 packages** — core, http, config, cli, swagger, testing, ws, prisma, drizzle, otel, graphql, queue, multi-tenant, vscode-extension
- [x] **17 example apps** — REST, GraphQL, WebSocket, SSE, OTel, Drizzle, queue, microservice, minimal
- [x] **5 project templates** — rest, graphql, ddd, microservice, minimal
- [x] **CLI** — `kick new`, `kick g` (10 generators), `kick add` (16 packages), `kick inspect`
- [x] **DevTools dashboard** — web UI at `/_debug` with health, metrics, routes, DI, WS stats
- [x] **Plugin system** — `KickPlugin` for bundling modules, adapters, middleware
- [x] **View engines** — EJS, Pug, Handlebars, Nunjucks via `ViewAdapter`
- [x] **4 queue providers** — BullMQ, RabbitMQ, Kafka, Redis Pub/Sub
- [x] **GraphQL** — `@Resolver`, `@Query`, `@Mutation`, `@Arg` + GraphiQL
- [x] **Multi-tenancy** — header/subdomain/path/query/custom resolution
- [x] **OpenTelemetry** — automatic tracing and metrics
- [x] **SSE** — `ctx.sse()` for real-time streaming
- [x] **Reactivity** — `ref`, `computed`, `watch`, `reactive`
- [x] **WebSocket** — `@WsController`, rooms, heartbeat, DevTools integration
- [x] **Pagination** — `ctx.paginate()` with `@ApiQueryParams`
- [x] **File uploads** — MIME map, `@FileUpload`, Swagger array support
- [x] **Migration guide** — Express to KickJS step-by-step
- [x] **VS Code extension** — health, routes, DI container views
