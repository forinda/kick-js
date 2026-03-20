# Roadmap

## v1.x — Next Up

### High Priority
- [ ] `@Cron` scheduler — decorator-based task scheduling with cron expressions
- [ ] `@Cacheable` decorator — method-level caching with pluggable backends (Redis, memory, LRU)
- [ ] Auth plugin — JWT, OAuth2, API keys, session auth out of the box
- [ ] Notification system — multi-channel (email, Slack, webhook, SMS, DB)
- [ ] `kick g scaffold` — generate full CRUD from field definitions (schema + module + migration)
- [ ] `kick tinker` — REPL with DI container and services loaded
- [ ] Admin panel adapter — auto-generated CRUD UI from Drizzle/Prisma schemas
- [ ] SPA integration — serve Vue/React/Svelte builds, Inertia.js-style server-driven UI

### Medium Priority
- [ ] `@Broadcast` decorator — auto-push events to WebSocket channels from mutations
- [ ] `@Before` / `@After` / `@Around` — AOP method interceptors
- [ ] `@OnEvent` decorator — typed event system with `post_save`, `pre_delete` style hooks
- [ ] `@Profile('dev')` — conditional service registration by environment
- [ ] `@ConfigProperties('database')` — bind whole config sections to typed classes
- [ ] Mailer adapter — email with template rendering (EJS/Pug) + queue integration
- [ ] Queue monitoring dashboard — `/_debug/queues` with job stats, failures, retries
- [ ] `kick secrets` — encrypted secrets vault (like Rails credentials)
- [ ] `kick deploy` — deploy to Fly.io, Railway, Render, Docker

### Community / Tutorial Patterns (not maintained in core)

These are ORM/DB-specific and vary by ecosystem. We provide tutorials in the [Custom Decorators Guide](./guide/custom-decorators.md) showing how to build them yourself:

- `@Transactional` — each ORM has its own transaction API
- `@BeforeSave` / `@AfterCreate` — ORM-specific lifecycle hooks
- Query scopes — depends on Drizzle/Prisma/Mongoose query builders
- Custom queue providers — RabbitMQ, SQS, etc. (tutorial + `QueueProvider` interface)

### Under Consideration
- [ ] TypeORM adapter
- [ ] gRPC support
- [ ] Docs i18n translation (build-time Google Translate)
- [ ] Turbo/HTMX-style server-driven UI with SSE + HTML fragments
- [ ] `kick console` / database REPL

## v1.0.0 — Shipped

- [x] **Adaptive architecture** — REST, GraphQL, WebSocket, SSE, queues (v1.0.0)
- [x] **16 packages** — core, http, config, cli, swagger, testing, ws, prisma, drizzle, otel, graphql, queue, multi-tenant, vscode-extension (v1.0.0)
- [x] **17 example apps** — REST, GraphQL, WebSocket, SSE, OTel, Drizzle, queue, microservice, minimal (v1.0.0)
- [x] **5 project templates** — rest, graphql, ddd, microservice, minimal (v0.7.x)
- [x] **CLI generators** — module, resolver, job, adapter, middleware, guard, service, controller, dto, config (v0.7.x)
- [x] **`kick add`** — registry-aware package installer with 16 packages (v0.7.x)
- [x] **`kick inspect`** — connect to running app, display routes/metrics/DI state (v0.7.x)
- [x] **DevTools dashboard** — web UI at `/_debug` with health, metrics, routes, DI, WebSocket stats (v0.6.x)
- [x] **Plugin system** — `KickPlugin` interface for bundling modules, adapters, middleware (v0.6.x)
- [x] **View engines** — pluggable EJS/Pug/Handlebars/Nunjucks with `ctx.render()` (v0.7.x)
- [x] **Build-time folder copying** — `copyDirs` in kick.config.ts (v0.7.x)
- [x] **4 queue providers** — BullMQ, RabbitMQ, Kafka, Redis Pub/Sub (v0.7.x)
- [x] **GraphQL** — `@Resolver`, `@Query`, `@Mutation`, `@Arg` with GraphiQL (v0.7.x)
- [x] **Multi-tenancy** — header/subdomain/path/query/custom resolution (v0.7.x)
- [x] **OpenTelemetry** — automatic tracing and metrics (v0.6.x)
- [x] **SSE** — `ctx.sse()` for real-time streaming (v0.6.x)
- [x] **Vue-inspired reactivity** — `ref`, `computed`, `watch`, `reactive` (v0.4.x)
- [x] **WebSocket** — `@WsController`, `@OnMessage`, rooms, heartbeat (v0.4.x)
- [x] **Drizzle adapter** — type-safe DB with query builder and transactions (v0.5.x)
- [x] **Prisma adapter** — DI integration and query building (v0.4.x)
- [x] **Swagger/OpenAPI** — auto-generated from decorators + Zod schemas (v0.3.x)
- [x] **`@ApiQueryParams`** — document filterable/sortable/searchable fields in Swagger (v0.5.x)
- [x] **`ctx.paginate()`** — standardized paginated responses with meta (v0.5.x)
- [x] **File uploads** — MIME map, `@FileUpload`, value-or-function `allowedTypes` (v0.4.x)
- [x] **Rate limiting, sessions, CSRF** — built-in middleware (v0.4.x)
- [x] **Migration guide** — step-by-step Express to KickJS (v0.7.x)
- [x] **Custom decorators guide** — tutorials for `@Transactional`, `@Cache`, `@Timed`, custom queues (v0.5.x)
- [x] **VS Code extension** — activity bar with health, routes, DI views (v0.7.x)
