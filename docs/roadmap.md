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
