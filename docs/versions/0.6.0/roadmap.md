# Roadmap

## Planned

- [x] WebSocket support via decorators (v0.4.x)
- [x] Drizzle database adapter (v0.5.x)
- [ ] TypeORM adapter
- [ ] GraphQL module
- [ ] CLI `kick deploy` command
- [x] OpenTelemetry integration — tracing and metrics via OtelAdapter (v0.6.x)
- [x] SSE (Server-Sent Events) — `ctx.sse()` helper for real-time streaming (v0.6.x)
- [x] Plugin system for community extensions (v0.6.x)
- [ ] Docs i18n translation (build-time Google Translate)

## Under Consideration

- [ ] gRPC support
- [ ] Queue/worker module (BullMQ, SQS)
- [ ] Multi-tenancy helpers
- [ ] VS Code extension (DI graph, route map, middleware pipeline)
- [ ] CLI `kick inspect` (connect to running app, show live state)

## Recently Completed

- [x] Drizzle ORM adapter with query builder and DI integration (v0.5.x)
- [x] WebSocket support — `@WsController`, `@OnMessage`, `@OnConnect`, rooms, heartbeat, DevTools integration (v0.4.x)
- [x] WebSocket example app with chat, rooms, and notifications (v0.4.x)
- [x] Swagger schema `name` attribute for request body and response schema mapping (v0.4.x)
- [x] npm keywords and cross-reference for package discoverability (v0.4.x)
- [x] DevToolsAdapter — reactive metrics, health, DI introspection at `/_debug/*` (v0.4.x)
- [x] Vue-inspired reactivity module — `ref`, `computed`, `watch`, `reactive` (v0.4.x)
- [x] `kick g config` command for existing projects (v0.4.x)
- [x] `kick new` directory safety prompts with `--force` flag (v0.4.x)
- [x] CLI generates `kick.config.ts` in new projects (v0.4.x)
- [x] Devtools example app with reactive concurrency tracking (v0.4.x)
- [x] File upload improvements — MIME map, short extensions, `@FileUpload` decorator, value-or-function `allowedTypes` (v0.4.x)
- [x] Comprehensive decorators reference page (v0.4.x)
- [x] Docs versioning with automatic snapshots on release (v0.4.x)
- [x] GitHub Pages deployment workflow (v0.4.x)
- [x] Rate limiting middleware (v0.4.x)
- [x] Session management middleware (v0.4.x)
- [x] Prisma database adapter (v0.4.x)
- [x] GitHub release CLI option, typesafe config keys, .env hot reload (v0.3.2)
- [x] Per-package README/LICENSE, npm scope rename (v0.3.1)
- [x] Monorepo rewrite with custom DI, Express 5, Zod, Vite HMR (v0.3.0)
