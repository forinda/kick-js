# KickJS Architecture Overhaul — Implementation Plan

> **Update (2026-04-04):** Phases 1-3 of this plan are largely complete. The Vite plugin work
> (Phase 7) has been redesigned based on benchmarking 6 frameworks (NestJS, H3/Nuxt, React Router,
> AdonisJS, TanStack Start, Vinxi). See **`v3/plan.md`** for the revised Vite plugin architecture
> and **`v3/architecture.md`** for how it all connects. Key changes from this plan:
> - httpServer piping solved (no middlewareMode — Vite creates the server, adapters attach to it)
> - Reactive container as universal event bus (Swagger, DevTools, WS all subscribe)
> - Batched HMR (debounced so `kick g module` creating 10+ files emits one update)

## Context

The `architecture.md` document (19 sections) describes a comprehensive overhaul of KickJS: build system migration (Turbo -> wireit + tsdown), HMR/rebuild stability fixes, DI container enhancements (request-scoped DI, observability), production readiness gaps, lifecycle fixes, devtools improvements, and a future Vite plugin with typegen. This plan breaks that into 7 independently shippable phases ordered by dependency and priority.

---

## Phase 1: HMR/Rebuild Critical Fixes (P0) — Size: S

**Goal:** Fix bugs that leave the dev server unrecoverable. Zero new features, pure stability.

**Dependencies:** None

### Changes

| Task | File | What |
|------|------|------|
| 1a | `packages/http/src/application.ts` (rebuild, L325-338) | Build new Express app + container fully before swapping. If setup() throws, log error and keep old app running |
| 1b | `packages/core/src/container.ts` (createInstance, L185-188) | Wrap `@PostConstruct` call in try/catch. Log error, continue — prevents single broken hook from crashing rebuild |
| 1c | `packages/core/src/container.ts` (createInstance) | After `@PostConstruct`, check if return is a Promise. Log warning: async PostConstruct won't be awaited |
| 1d | `packages/core/src/decorators.ts` (allRegistrations, L17) | Change key from class reference to class name string. Same-name class replaces old entry instead of accumulating |

### Verification

- `pnpm build && pnpm test` passes
- New tests: PostConstruct throwing doesn't crash resolve(), async PostConstruct warns, allRegistrations doesn't leak, rebuild() failure keeps old app alive

---

## Phase 2: Lifecycle & Manual Registration Fixes — Size: M

**Goal:** Make lifecycle async-safe, preserve manual DI registrations across HMR.

**Dependencies:** Phase 1

### Changes

| Task | File | What |
|------|------|------|
| 2a | `packages/core/src/container.ts` | Track `registerFactory()` and `registerInstance()` calls in a replay list. Replay on `Container.reset()` so DB/Redis connections survive HMR |
| 2b | `packages/http/src/application.ts` (callHook, L124-138) | Make async — await Promise-returning hooks. Make `setup()` async. Update `start()`, `rebuild()`, `registerOnly()` to await |
| 2c | `packages/http/src/application.ts` (L169-174, L229) | Wrap `plugin.middleware()` and `adapter.onRouteMount()` in try/catch |
| 2d | `packages/http/src/application.ts` (start, L309-322) | Wrap `httpServer.listen()` callback in Promise so `afterStart`/`onReady` errors propagate |
| 2e | `packages/http/src/application.ts` (shutdown, L341-358) | Add `shutdownTimeout` option (default 30s). Force `process.exit(1)` if exceeded |

### Verification

- Existing application tests pass
- New tests: async hook errors propagate, plugin.middleware() throw doesn't crash setup, shutdown timeout works, registerFactory() survives reset()

---

## Phase 3: DI Container Enhancements (Observability) — Size: M

**Goal:** Add CLASS_KIND metadata, resolution metrics, dependency tracking. Foundation for DevTools (Phase 6) and Request-Scoped DI (Phase 5).

**Dependencies:** Phase 1

### Changes

| Task | File | What |
|------|------|------|
| 3a | `packages/core/src/interfaces.ts` (METADATA, L31-49) | Add `CLASS_KIND: Symbol('kick:class-kind')` |
| 3b | `packages/core/src/decorators.ts` | In Service/Controller/Repository/Component/Injectable — add `Reflect.defineMetadata(METADATA.CLASS_KIND, kind, target)` |
| 3c | `packages/core/src/container.ts` (Registration, L5-10) | Extend interface: `kind`, `resolveCount`, `lastResolvedAt`, `firstResolvedAt`, `resolveDurationMs`, `postConstructStatus`, `dependencies` |
| 3d | `packages/core/src/container.ts` (resolve, L121-159) | Increment resolveCount, set timestamps, measure resolution time with `performance.now()` |
| 3e | `packages/core/src/container.ts` | Add `extractDependencies(target)` — reads `design:paramtypes` + `METADATA.INJECT` to build dependency token list |
| 3f | `packages/core/src/container.ts` (createInstance) | Set `reg.postConstructStatus` to completed/failed/skipped |
| 3g | `packages/core/src/container.ts` (getRegistrations, L108-118) | Return all new fields. Fix transient `instantiated` check: use `resolveCount > 0` |

### Verification

- `@Service()` has CLASS_KIND='service', `@Controller()` has 'controller', etc.
- After resolve(), getRegistrations() shows resolveCount > 0, correct dependencies array
- Transient services show instantiated=true after first resolve (currently broken)

---

## Phase 4: Build System Migration (Turbo -> wireit + tsdown) — Size: L

**Goal:** Replace build toolchain. Mechanically repetitive across 18+ packages.

**Dependencies:** None (can run in parallel with Phases 2-3, but best merged after Phase 3 for test coverage)

### Changes

| Task | Files | What |
|------|-------|------|
| 4a | Root `package.json` | Add `wireit`, `tsdown` to devDeps. Remove `turbo` |
| 4b | New `build.utils.ts` at root | `createBanner(name, version)` + `readPkg(dir)` helpers |
| 4c | Each `packages/*/` (x18) | Create `tsdown.config.ts` (translate entries from vite.config.ts). Update package.json: build script -> wireit, add wireit section with command/files/output/dependencies. Delete `vite.config.ts` and `tsconfig.build.json` |
| 4d | Root `package.json` | Replace all `turbo run ...` scripts with `pnpm -r ...` equivalents |
| 4e | `turbo.json` | Delete |
| 4f | `.gitignore` | Replace `.turbo/` with `.wireit/` |
| 4g | `tsconfig.base.json` | Optionally add `isolatedDeclarations: true` for fast oxc DTS |

**Wireit dependency graph:**

```
Level 0: core, config (no deps)
Level 1: http, auth, ws, queue, cron, mailer, prisma, drizzle, multi-tenant, notifications (-> core)
Level 2: cli, swagger, graphql, testing, devtools, otel (-> core + http)
```

### Verification

- `pnpm -r run build` builds all packages
- dist/ contains .js + .d.ts matching current output
- `pnpm test` passes
- Incremental: `touch packages/core/src/container.ts && pnpm -r run build` rebuilds core + dependents, skips others
- Built .js files contain copyright banner
- No turbo.json, no .turbo/ directories

---

## Phase 5: Request-Scoped DI + Production Readiness — Size: L

**Goal:** Add Scope.REQUEST via AsyncLocalStorage. Add health checks, shutdown timeout, CORS defaults.

**Dependencies:** Phase 3 (resolve() enhancements)

### Changes

| Task | File | What |
|------|------|------|
| 5a | `packages/core/src/interfaces.ts` (Scope enum) | Add `REQUEST = 'request'` |
| 5b | New `packages/http/src/request-store.ts` | AsyncLocalStorage-based RequestStore: requestId, instances Map, values Map |
| 5c | New `packages/http/src/middleware/request-scope.ts` | Middleware wrapping each request in `requestStore.run()` |
| 5d | `packages/core/src/container.ts` (resolve) | Add REQUEST scope branch: check store values, then store instance cache, then create+cache. Use pluggable `Container._requestStoreProvider` to avoid hard dep on http package |
| 5e | `packages/core/src/container.ts` (createInstance) | Scope validation: SINGLETON injecting REQUEST throws error |
| 5f | `packages/http/src/application.ts` (setup) | Wire requestScopeMiddleware() early in default middleware stack |
| 5g | `packages/http/src/application.ts` | Add `/health/live` (200 + uptime) and `/health/ready` (adapter health checks) endpoints before API prefix |
| 5h | `packages/core/src/adapter.ts` | Add optional `onHealthCheck?()` to AppAdapter interface |
| 5i | `packages/http/src/middleware/cors.ts` | Default `origin: false` (restrictive) instead of `'*'` |
| 5j | `packages/core/src/logger.ts` | Auto-inject requestId from AsyncLocalStorage into log context |

### Verification

- REQUEST-scoped service: fresh per request, cached within same request
- SINGLETON injecting REQUEST: throws validation error
- REQUEST scope outside request: throws meaningful error
- /health/live returns 200, /health/ready returns 200/503
- Logger includes requestId automatically during requests

---

## Phase 6: DevTools Enhancements — Size: M

**Goal:** Upgrade dashboard with CLASS_KIND, metrics, dependency graph, SSE.

**Dependencies:** Phase 3 (enhanced getRegistrations())

### Changes

| Task | File | What |
|------|------|------|
| 6a | `packages/devtools/src/adapter.ts` | Update /_debug/container to return kind, resolveCount, postConstructStatus, dependencies |
| 6b | `packages/devtools/src/adapter.ts` | New `GET /_debug/graph` — nodes/edges from dependency data |
| 6c | `packages/devtools/src/adapter.ts` | New `GET /_debug/stream` — SSE endpoint using reactive watch() |
| 6d | `packages/devtools/src/adapter.ts` | Replace min/max latency with ring buffer p50/p95/p99 |
| 6e | `packages/devtools/public/` | Update dashboard UI: kind column, status badges, resolve count, basic dependency graph |

### Verification

- /_debug container tab shows kind/status/resolveCount
- /_debug/graph returns valid node/edge JSON
- /_debug/stream emits SSE events on requests

---

## Phase 7: Vite Plugin + Typegen (Future) — Size: XL

**Goal:** First-class Vite integration and typed container.resolve().

**Dependencies:** All of Phases 1-6

### Sub-phase 7a: Vite Plugin

- New `packages/vite/` — plugin array: core, virtual-modules, hmr, module-discovery, dev-server
- Virtual modules: `virtual:kickjs/server-entry`, `virtual:kickjs/container-registry`
- Selective HMR via handleHotUpdate() + container dependency graph
- Dev server via configureServer() hook

### Sub-phase 7b: Typegen

- `kick typegen` command — scan decorated classes, generate `.kickjs/types/container.d.ts`
- ContainerTokenMap for fully typed `container.resolve()`
- Watch mode integrated with `kick dev`

---

## Execution Order

```
Phase 1 (S) ─────> Phase 2 (M) ─────> Phase 5 (L)
    |                                      |
    +────> Phase 3 (M) ──────> Phase 6 (M)
                                           |
Phase 4 (L, parallel) ────────────────────>|
                                           v
                                    Phase 7 (XL, future)
```

**Recommended start:** Phase 1 first (quick wins, unblocks everything).

## Critical Files (touched most)

- `packages/core/src/container.ts` — Phases 1, 2, 3, 5
- `packages/http/src/application.ts` — Phases 1, 2, 5
- `packages/core/src/decorators.ts` — Phases 1, 3
- `packages/core/src/interfaces.ts` — Phases 3, 5
- `packages/devtools/src/adapter.ts` — Phase 6
