# Roadmap

## v1.x — Planned

- [x] `@Cron` scheduler — `@forinda/kickjs-cron` with pluggable CronScheduler (croner, interval, custom)
- [x] `@Cacheable` decorator — pluggable CacheProvider (memory default, Redis, custom)
- [x] Auth plugin — `@forinda/kickjs-auth` with JWT, API key, and custom strategies
- [x] `kick g scaffold` — generate full CRUD module from field definitions
- [x] `kick tinker` — REPL with DI container loaded
- [ ] `kick deploy` — deploy to Fly.io, Railway, Docker
- [x] SPA integration — `SpaAdapter` serves Vue/React/Svelte builds alongside API
- [x] Mailer adapter — `@forinda/kickjs-mailer` with pluggable MailProvider (SMTP, Resend, SES, custom)
- [x] Queue monitoring in DevTools dashboard — `/_debug/queues` tab with job counts
- [x] Notification system — `@forinda/kickjs-notifications` with email, Slack, Discord, webhook
- [ ] Type-safe API client generation (tRPC-like) — `kick generate:client` from route decorators + Zod DTOs (KICK-018)

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
