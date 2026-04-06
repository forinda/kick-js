# v2 Showcase API

A focused example demonstrating the key features introduced in KickJS v2.0.

## What It Shows

- **Vite Plugin** (`@forinda/kickjs-vite`) — first-class Vite integration with virtual modules, module discovery, and selective HMR
- **Health Checks** — `/health/live` and `/health/ready` endpoints built into the framework
- **Request-Scoped DI** — `Scope.REQUEST` for per-request service instances via AsyncLocalStorage
- **DI Observability** — `CLASS_KIND` metadata, resolve metrics, dependency tracking
- **DevTools Dashboard** — enhanced container tab with kind, status, resolve count, dependency graph
- **Async Lifecycle** — all adapter hooks are properly awaited
- **In-Memory Repository** — clean DDD architecture with interface-based DI

## Quick Start

```bash
cd examples/v2-showcase-api
pnpm install
kick dev
```

## Key URLs

| Endpoint | Description |
|----------|-------------|
| `GET /api/v1/tasks` | List all tasks |
| `POST /api/v1/tasks` | Create a task (JSON body: `{ title, description? }`) |
| `GET /api/v1/tasks/:id` | Get task by ID |
| `PUT /api/v1/tasks/:id` | Update task |
| `DELETE /api/v1/tasks/:id` | Delete task |
| `GET /health/live` | Liveness probe (always 200) |
| `GET /health/ready` | Readiness probe (checks adapter health) |
| `GET /_debug?token=...` | DevTools dashboard |
| `GET /_debug/graph?token=...` | DI dependency graph (JSON) |
| `GET /_debug/stream?token=...` | Real-time metrics (SSE) |
| `GET /api-docs` | Swagger UI |

## Project Structure

```
v2-showcase-api/
  vite.config.ts                  # Uses kickjs() Vite plugin
  kick.config.ts                  # CLI config (DDD pattern, in-memory repo)
  src/
    index.ts                      # Bootstrap with DevTools + Swagger
    modules/
      index.ts                    # Module registry
      tasks/
        index.ts                  # TaskModule (register + routes)
        domain/
          task.entity.ts          # Entity, Zod schemas, repository interface
        application/
          task.service.ts         # @Service with @Inject(TASK_REPOSITORY)
        presentation/
          task.controller.ts      # @Controller with CRUD endpoints
        infrastructure/
          in-memory-task.repository.ts  # @Repository implementation
```

## Key Code

### Vite Config (uses kickjs plugin)

```ts
import { defineConfig } from 'vite'
import { kickjsVitePlugin } from '@forinda/kickjs-vite'
import swc from 'unplugin-swc'

export default defineConfig({
  plugins: [kickjsVitePlugin(), swc.vite()],
  // ...
})
```

### Bootstrap with Health Checks

Health check endpoints (`/health/live` and `/health/ready`) are automatically mounted by the framework. Adapters can implement `onHealthCheck()` to contribute to readiness checks.

```ts
bootstrap({
  modules,
  adapters: [devtools, swagger],
  middleware: [helmet(), cors({ origin: '*' }), requestId(), requestLogger(), validate(), express.json()],
})
```

### Interface-Based DI

```ts
// Domain layer defines the interface
export const TASK_REPOSITORY = Symbol('TaskRepository')
export interface ITaskRepository { /* ... */ }

// Module binds interface to implementation
container.registerFactory(TASK_REPOSITORY, () =>
  container.resolve(InMemoryTaskRepository),
)

// Service injects by interface
@Service()
export class TaskService {
  constructor(@Inject(TASK_REPOSITORY) private readonly repo: ITaskRepository) {}
}
```

### Type Generation

Generate fully typed `container.resolve()` calls:

```bash
kick typegen           # one-shot
kick typegen --watch   # continuous
```

This creates `.kickjs/types/container.d.ts` with a `ContainerTokenMap` so `container.resolve('TaskService')` returns `TaskService` instead of `any`.

## v2 Features Demonstrated

| Feature | Where |
|---------|-------|
| Vite plugin | `vite.config.ts` — `kickjs()` replaces manual config |
| Health checks | Auto-mounted at `/health/live` and `/health/ready` |
| Async lifecycle | `setup()`, `start()`, `rebuild()` are all async |
| DI observability | `/_debug/container` shows kind, resolveCount, dependencies |
| Dependency graph | `/_debug/graph` returns DI graph as nodes/edges JSON |
| SSE metrics | `/_debug/stream` pushes real-time request/error counts |
| Latency percentiles | `/_debug/metrics` includes p50/p95/p99 per route |
| Build banners | Built files include copyright header |
| Restrictive CORS | Default `origin: false` (explicit opt-in required) |

[View source on GitHub](https://github.com/forinda/kick-js/tree/main/examples/v2-showcase-api)
