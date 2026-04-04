# KickJS v3 Architecture — Connecting the Dots

> How the benchmark research maps to KickJS's actual codebase, and the concrete architecture that emerges.

---

## 1. Where KickJS Stands Today (v2)

### Current Data Flow

```
kick dev (CLI)
  |
  +-- startDevServer() [packages/cli/src/commands/run.ts]
  |     +-- createServer({ middlewareMode: true, appType: 'custom' })
  |     +-- env.runner.import('/src/index.ts')  <-- Vite SSR Environment
  |
  +-- src/index.ts [user code]
  |     +-- bootstrap({ modules, adapters, middleware })
  |
  +-- Application [packages/http/src/application.ts]
        +-- new Express()
        +-- Container.getInstance() [packages/core/src/container.ts]
        +-- setup() pipeline:
        |     1. adapter.beforeMount() hooks
        |     2. Hardened defaults (disable x-powered-by, trust proxy)
        |     3. Health endpoints (/health/live, /health/ready)
        |     4. Request scope middleware (AsyncLocalStorage)
        |     5. Adapter middleware (beforeGlobal phase)
        |     6. Plugin registration + plugin middleware
        |     7. Global middleware (user-declared or defaults)
        |     8. Adapter middleware (afterGlobal phase)
        |     9. Module registration + DI bootstrap
        |    10. Adapter middleware (beforeRoutes phase)
        |    11. Mount module routes with versioning (/api/v1/...)
        |    12. Adapter middleware (afterRoutes phase)
        |    13. Error handlers (404 + global)
        |    14. adapter.beforeStart() hooks
        +-- start():
        |     +-- http.createServer(expressApp)
        |     +-- httpServer.listen(port)
        |     +-- adapter.afterStart() hooks
        |     +-- plugin.onReady() hooks
        +-- rebuild() [HMR]:
              +-- Container.reset()
              +-- new Express() + new Container
              +-- setup() again (full pipeline replay)
              +-- httpServer.removeAllListeners('request')
              +-- httpServer.on('request', newExpressApp)  <-- swap!
```

### Current DI Flow

```
Decorator fires at import time (@Service, @Controller, etc.)
  |
  +-- registerInContainer() [packages/core/src/decorators.ts]
  |     +-- Reflect.defineMetadata(INJECTABLE, true, target)
  |     +-- Reflect.defineMetadata(SCOPE, scope, target)
  |     +-- Reflect.defineMetadata(CLASS_KIND, kind, target)
  |     +-- allRegistrations.set(className, { target, scope })  <-- survives HMR
  |     +-- container.register(target, target, scope)  [if container exists]
  |     +-- OR pendingRegistrations.push(...)  [if container not ready]
  |
  +-- Container.getInstance() first call:
  |     +-- flushPending() → register all queued decorators
  |
  +-- container.resolve(token):
  |     +-- Check: already resolved singleton? Return cached
  |     +-- Read Reflect.getMetadata('design:paramtypes', target) → [Dep1, Dep2, ...]
  |     +-- Recursively resolve each dependency
  |     +-- new target(dep1, dep2, ...)
  |     +-- Run @PostConstruct if present
  |     +-- Cache instance (if SINGLETON)
  |     +-- Track: resolveCount, timestamps, duration

  +-- Container.reset() [on HMR]:
        +-- Clear all registrations + instances
        +-- _onReset callback → replay allRegistrations map
        +-- Replay factoryRegistrations (DB connections, etc. — persistent)
        +-- Replay instanceRegistrations (persistent bindings)
```

### Current Reactivity System

```
packages/core/src/reactivity.ts — Already exists!
  |
  +-- ref(value)     → Proxy with track/trigger + subscribers
  +-- computed(fn)   → Cached + dirty flag + auto-recompute
  +-- watch(source, cb) → Effect tracking + callback on change
  +-- reactive(obj)  → Deep Proxy with track/trigger
  |
  Not yet connected to:
    - Container (registrations are plain Map, not reactive)
    - DevTools (polling, not subscriptions)
    - Adapters (no change notifications)
    - Vite HMR (no selective invalidation)
```

### What Each Benchmark Framework Taught Us

| Problem | NestJS Answer | H3/Nuxt Answer | React Router Answer | AdonisJS Answer | TanStack Answer | Vinxi Answer |
|---------|--------------|----------------|--------------------|--------------------|------------------|--------------|
| Who owns HTTP port in dev? | Express (external Webpack) | Nitro/H3 | **Vite** | AdonisJS | **Vite** | Nitro/H3 |
| How to HMR server code? | Full app teardown | dynamicEventHandler swap | **ssrLoadModule() per request** | Process restart | ssrLoadModule() | ssrLoadModule() |
| How to preserve DB connections? | N/A (full restart) | N/A (no DI) | globalThis cache | Container singletons | N/A | globalThis |
| How to organize Vite plugin? | N/A | Plugin stack (10+) | **Plugin array (14+)** | Single middleware | **Composed array (10+)** | Per-router plugins |
| How to integrate Express? | Platform adapter | H3 middleware mount | **Fetch API bridge** | N/A (own server) | Fetch API bridge | Nitro handlers |
| How to do selective invalidation? | N/A | Module graph walk | **Virtual module invalidation** | N/A | Virtual module invalidation | Virtual modules |

---

## 2. V3 Target Architecture

### 2.1 — The Big Picture

```
                    ┌─────────────────────────────────────────┐
                    │            @forinda/kickjs-vite          │
                    │          (Vite Plugin Array)             │
                    │                                          │
                    │  ┌──────────┐ ┌──────────┐ ┌──────────┐│
                    │  │  core    │ │  virtual  │ │   hmr    ││
                    │  │  plugin  │ │  modules  │ │  plugin  ││
                    │  └──────────┘ └──────────┘ └──────────┘│
                    │  ┌──────────┐ ┌──────────┐              │
                    │  │  module  │ │   dev    │              │
                    │  │ discover │ │  server  │              │
                    │  └──────────┘ └──────────┘              │
                    └─────────────┬───────────────────────────┘
                                  │
                    ┌─────────────▼───────────────────────────┐
                    │         Vite Dev Server                  │
                    │         (owns port in dev)               │
                    │                                          │
                    │  configureServer() hook:                 │
                    │    For each request:                     │
                    │      ssrLoadModule('virtual:kickjs/app') │
                    │        → Fresh Application per request   │
                    │        → Express adapter handles request │
                    └─────────────┬───────────────────────────┘
                                  │
                    ┌─────────────▼───────────────────────────┐
                    │      Reactive Container                  │
                    │      (packages/core)                     │
                    │                                          │
                    │  ┌─────────┐    ┌──────────────┐        │
                    │  │  ref()  │    │  Container   │        │
                    │  │computed │◄───│  .registrations│       │
                    │  │ watch() │    │  (ReactiveMap)│        │
                    │  └────┬────┘    └──────────────┘        │
                    │       │                                  │
                    │  ┌────▼─────────────────────┐           │
                    │  │  Subscribers              │           │
                    │  │  - DevTools SSE stream    │           │
                    │  │  - WebSocket adapter      │           │
                    │  │  - Vite HMR callback      │           │
                    │  │  - Logger context          │           │
                    │  └──────────────────────────┘           │
                    └─────────────────────────────────────────┘
                                  │
                    ┌─────────────▼───────────────────────────┐
                    │      Production Mode                     │
                    │      (Express owns port, no Vite)        │
                    │                                          │
                    │  kick start → tsc/tsdown → node dist/   │
                    │  Reactive proxies compile to direct refs │
                    │  No virtual modules, no ssrLoadModule    │
                    └─────────────────────────────────────────┘
```

### 2.2 — Package Boundaries

```
@forinda/kickjs-core (existing — enhanced)
  ├── container.ts        → ReactiveContainer (wraps registrations in reactive Map)
  ├── reactivity.ts       → ref, computed, watch, reactive (already exists!)
  ├── decorators.ts       → @Service, @Controller, etc. (unchanged API)
  ├── interfaces.ts       → Scope.REQUEST, ClassKind (already exists!)
  ├── adapter.ts          → AppAdapter + new onRebuild?() hook
  └── plugin.ts           → KickPlugin (unchanged)

@forinda/kickjs-http (existing — enhanced)
  ├── application.ts      → Application with rebuild() using reactive invalidation
  ├── request-store.ts    → AsyncLocalStorage for REQUEST scope (already exists!)
  ├── bootstrap.ts        → bootstrap() (unchanged API)
  └── middleware/          → cors, helmet, requestId, etc. (unchanged)

@forinda/kickjs-vite (NEW)
  ├── plugin.ts           → kickjsVitePlugin() returns Plugin[]
  ├── core-plugin.ts      → Vite config, SSR environment setup
  ├── virtual-modules.ts  → virtual:kickjs/app, virtual:kickjs/modules, virtual:kickjs/manifest
  ├── hmr-plugin.ts       → handleHotUpdate(), selective container invalidation
  ├── module-discovery.ts → Scan for @Controller/@Service via transform() hook
  └── dev-server.ts       → configureServer() — mounts Express on Vite

@forinda/kickjs-cli (existing — updated)
  └── commands/run.ts     → `kick dev` uses @forinda/kickjs-vite instead of inline Vite setup
```

### 2.3 — Virtual Modules (The Contract)

```typescript
// ── virtual:kickjs/app ──────────────────────────────────────────
// Generated by module-discovery plugin. Imported by dev-server on each request.
// Contains the full application bootstrap with auto-discovered modules.

import { bootstrap } from '@forinda/kickjs-http'
import { UserModule } from './src/modules/users/user.module'
import { PostModule } from './src/modules/posts/post.module'

export const app = bootstrap({
  modules: [UserModule, PostModule],
  // middleware and adapters come from kick.config.ts (also virtual)
})

// ── virtual:kickjs/modules ──────────────────────────────────────
// Just the module list, for devtools and typegen consumption.

export const modules = [
  { name: 'UserModule', path: './src/modules/users/user.module.ts' },
  { name: 'PostModule', path: './src/modules/posts/post.module.ts' },
]

// ── virtual:kickjs/manifest ─────────────────────────────────────
// Container metadata for devtools dashboard.

export const manifest = {
  services: [
    { token: 'UserService', kind: 'service', module: 'users', scope: 'singleton' },
    { token: 'PostService', kind: 'service', module: 'posts', scope: 'singleton' },
  ],
  controllers: [
    { token: 'UserController', kind: 'controller', routes: ['GET /users', 'POST /users'] },
  ],
  adapters: ['SwaggerAdapter', 'PrismaAdapter'],
}
```

### 2.4 — Reactive Container (The Core Innovation)

**Current:** `Container.registrations` is a plain `Map<token, Registration>`. Changes are invisible.

**V3:** Wrap registration access in the existing reactivity system.

```typescript
// packages/core/src/container.ts — enhanced

import { ref, watch, type Ref } from './reactivity'

export class Container {
  // Current: private registrations = new Map<any, Registration>()
  // V3: Each registration's instance is a ref()
  private registrations = new Map<any, Registration & { instanceRef: Ref<any> }>()
  
  // New: observable registration count (devtools subscribes to this)
  readonly registrationCount = ref(0)
  
  resolve(token: any): any {
    const reg = this.registrations.get(token)
    if (!reg) throw new Error(`No provider for ${tokenName(token)}`)
    
    if (reg.scope === Scope.SINGLETON) {
      if (reg.instanceRef.value !== undefined) return reg.instanceRef.value
      const instance = this.createInstance(reg)
      reg.instanceRef.value = instance  // Triggers subscribers!
      return instance
    }
    // ... REQUEST and TRANSIENT scopes
  }
  
  /**
   * Invalidate a specific registration. Called by Vite HMR plugin
   * when a module changes. Clears the cached instance so next resolve()
   * creates a fresh one. Triggers reactive subscribers.
   */
  invalidate(token: any): void {
    const reg = this.registrations.get(token)
    if (!reg) return
    if (reg.persistent) return  // DB connections etc. survive invalidation
    
    // Clear instance — next resolve() will re-create
    reg.instanceRef.value = undefined
    reg.resolveCount = 0
    
    // Invalidate dependents (anything that injected this token)
    for (const [depToken, depReg] of this.registrations) {
      if (depReg.dependencies.includes(tokenName(token))) {
        this.invalidate(depToken)  // Recursive — walks the dependency graph
      }
    }
  }
  
  /**
   * Subscribe to all container changes. Used by DevTools SSE stream.
   */
  onChange(callback: (token: any, event: 'registered' | 'resolved' | 'invalidated') => void) {
    // Uses the reactivity system's watch() internally
  }
}
```

**How it connects to what exists:**
- `reactivity.ts` already has `ref()`, `watch()`, `computed()` — no new primitives needed
- `container.ts` already tracks `resolveCount`, `dependencies`, `postConstructStatus` — just wrap in reactive
- `adapter.ts` already has lifecycle hooks — add `onRebuild?()`
- `devtools` already has `/_debug/container` endpoint — replace polling with SSE subscription

### 2.5 — HMR Flow (V3)

```
File Change (src/modules/users/user.service.ts)
  |
  +-- Vite detects change, invalidates module in SSR module graph
  |
  +-- kickjs:hmr-plugin handleHotUpdate() fires
  |     +-- Is this a KickJS decorated file? (check CLASS_KIND metadata)
  |     +-- YES: invalidateVirtualModules(server)  ← force re-generation
  |     +-- Map file → DI token(s) affected
  |     +-- container.invalidate('UserService')
  |     |     +-- Clears cached instance
  |     |     +-- Walks dependency graph → also invalidates UserController
  |     |     +-- Reactive trigger → DevTools SSE notified
  |     +-- server.hot.send({ event: 'kickjs:hmr', data: { token: 'UserService' } })
  |
  +-- Next HTTP request arrives:
        +-- dev-server plugin calls ssrLoadModule('virtual:kickjs/app')
        +-- Vite re-evaluates the virtual module (picks up new UserService code)
        +-- bootstrap() runs with fresh module imports
        +-- Container resolves UserService → creates new instance (old was invalidated)
        +-- Express handles request with fresh code
        +-- DB connections still work (persistent registrations survived)
```

**Compare with current HMR (v2):**
```
File Change → Vite env.runner re-evaluates → all decorators re-fire →
Container.reset() → replay ALL registrations → new Express() → full setup() →
swap httpServer listener
```

V3 is **surgical**: only the changed service and its dependents are invalidated. Everything else (routes, middleware, DB connections) stays warm.

### 2.6 — The httpServer Problem (Socket.IO, WebSockets, etc.)

**The core concern:** Libraries like Socket.IO, KickJS's own `WsAdapter`, GraphQL subscriptions,
and any library that needs `server.on('upgrade', ...)` require access to the raw `http.Server`.

**Current KickJS flow** (`packages/ws/src/ws-adapter.ts:135-159`):
```typescript
// WsAdapter.afterStart() receives the http.Server via AdapterContext
afterStart({ server }: AdapterContext): void {
  this.wss = new WebSocketServer({ noServer: true })
  server.on('upgrade', (request, socket, head) => {
    // Route WebSocket connections to @WsController namespaces
    this.wss.handleUpgrade(request, socket, head, (ws) => {
      this.handleConnection(ws, entry)
    })
  })
}
```

**The problem with "Vite owns the port":**

From Vite source (`packages/vite/src/node/server/index.ts:315-317`):
```typescript
/**
 * native Node http server instance
 * will be null in middleware mode    ← THIS IS THE PROBLEM
 */
httpServer: HttpServer | null
```

- `middlewareMode: true` → `httpServer` is **null** (Vite doesn't create a server)
- `middlewareMode: false` (Vite owns the port) → `httpServer` is the **real http.Server**

**Solution: Don't use middlewareMode. Let Vite listen, then pipe its httpServer to adapters.**

```
Vite Dev Server (creates http.Server, owns port 3000)
  │
  ├── viteServer.httpServer  ← Real Node.js http.Server!
  │     │
  │     ├── WsAdapter:    server.on('upgrade', ...)        ✅ WORKS
  │     ├── Socket.IO:    new SocketIOServer(httpServer)   ✅ WORKS
  │     ├── GraphQL WS:   useServer(schema, httpServer)    ✅ WORKS
  │     └── ANY library:  httpServer.on('upgrade', ...)    ✅ WORKS
  │
  ├── viteServer.middlewares (Connect stack)
  │     ├── Vite static assets + HMR client
  │     └── KickJS Express app (via configureServer post-hook)
  │
  └── viteServer.ws (Vite's own HMR WebSocket — separate channel, doesn't conflict)
```

**How the Vite plugin pipes the httpServer to adapters:**

```typescript
// packages/vite/src/dev-server.ts

export function kickjsDevServerPlugin(ctx: PluginContext): Plugin {
  return {
    name: 'kickjs:dev-server',

    configureServer(viteServer) {
      // ━━━ THE KEY: store the REAL http.Server on globalThis ━━━
      // This persists across HMR module re-evaluations.
      // Adapters (WsAdapter, Socket.IO, etc.) will find it here.
      globalThis.__kickjs_httpServer = viteServer.httpServer

      // Post-middleware: Express handles requests Vite doesn't
      return () => {
        viteServer.middlewares.use(async (req, res, next) => {
          try {
            const mod = await viteServer.environments.ssr.runner.import(
              'virtual:kickjs/app'
            )
            if (mod.app?.handle) {
              mod.app.handle(req, res, (err?: any) => {
                if (err) return next(err)
                next()
              })
            } else {
              next()
            }
          } catch (err) {
            viteServer.ssrFixStacktrace(err as Error)
            next(err)
          }
        })
      }
    },
  }
}
```

**How Application detects dev vs prod and pipes the server:**

```typescript
// packages/http/src/application.ts — v3 enhancement

async start(): Promise<void> {
  await this.setup()

  if (globalThis.__kickjs_httpServer) {
    // ── DEV MODE: Vite owns the http.Server ──────────────────
    this.httpServer = globalThis.__kickjs_httpServer
    log.info('Attached to Vite dev server (httpServer piped to adapters)')
  } else {
    // ── PRODUCTION: We create our own http.Server ────────────
    const port = this.options.port ?? parseInt(process.env.PORT || '3000', 10)
    this.httpServer = http.createServer(this.app)
    await new Promise<void>((resolve) => {
      this.httpServer!.listen(port, () => resolve())
    })
    log.info(`Server running on http://localhost:${port}`)
  }

  // ── SAME flow in both modes — adapters always get real httpServer ──
  for (const adapter of this.adapters) {
    const ctx = this.adapterCtx(this.httpServer!)
    //                          ^^^^^^^^^^^^^^^^^
    //   Dev:  Vite's httpServer
    //   Prod: Our httpServer
    //   Either way: real http.Server. Adapters don't care which.
    await this.callHook(adapter.afterStart?.bind(adapter), ctx)
  }
}
```

**WsAdapter requires ZERO changes.** It already does:
```typescript
afterStart({ server }: AdapterContext): void {
  // 'server' is the real http.Server in BOTH dev and prod
  this.wss = new WebSocketServer({ noServer: true })
  server.on('upgrade', (request, socket, head) => { ... })  // Just works
}
```

**Same for any future adapter that needs httpServer:**
```typescript
// Socket.IO adapter (hypothetical)
afterStart({ server }: AdapterContext): void {
  this.io = new SocketIOServer(server)  // Works in dev (Vite's server) and prod
}

// GraphQL subscriptions adapter (hypothetical)
afterStart({ server }: AdapterContext): void {
  useServer({ schema }, server)  // Works everywhere
}
```

**How Vinxi solves the same problem** (`lib/nitro-dev.js:306-321`):
```javascript
const listener = await listen(toNodeListener(app), { port, ws: true })
// listener.server IS the real http.Server
listener.server.on("upgrade", (req, sock, head) => {
  adapter.handleUpgrade(req, sock, head)
})
```
Same pattern: framework creates the server, passes it to handlers that need upgrade events.

**What about HMR + WebSocket connections?**

When a file changes:
1. `ssrLoadModule()` re-evaluates the virtual module → new Express app
2. But the `http.Server` is **NOT recreated** (Vite owns it, it persists)
3. WebSocket connections stay alive (they're on the http.Server, not Express)
4. `WsAdapter` must persist across HMR (it holds socket state + room memberships)

This is why persistent state (Step 1 in the plan) is critical:
```typescript
// WsAdapter instance is stored on globalThis — survives module re-evaluation
if (!globalThis.__kickjs_wsAdapter) {
  globalThis.__kickjs_wsAdapter = new WsAdapter({ path: '/ws' })
}
const wsAdapter = globalThis.__kickjs_wsAdapter

bootstrap({
  modules: [...],
  adapters: [wsAdapter],  // Same instance across HMR cycles
})
```

### 2.7 — Production Mode (No Vite)

```typescript
// kick start → runs compiled JS directly
// packages/cli/src/commands/run.ts

async function startProductionServer(entry: string) {
  // No Vite, no virtual modules, no HMR
  // Just import the compiled entry and start
  const { app } = await import(resolve(entry))
  // app.start() uses Express directly
}
```

In production:
- `bootstrap()` works exactly as today
- No reactive overhead (registrations are plain Map — reactivity only activates in dev)
- No virtual modules (modules are imported statically in user code)
- Express owns the port directly

---

## 3. How V3 Maps to Issue #85 Phases

| Issue #85 Phase | V3 Component | Status |
|----------------|--------------|--------|
| Phase 1: Request-Scoped DI | `request-store.ts`, `Scope.REQUEST`, `container.resolve()` REQUEST branch | **Already implemented** |
| Phase 1: Lifecycle Async Safety | `callHook()` async, `setup()` async, try/catch wrapping | **Already implemented** |
| Phase 1: Sample Module | CLI template generator | Planned (Phase 3 in PLAN.md) |
| Phase 2: tsdown Migration | Build system change | Independent track |
| Phase 2: wireit | Orchestration change | Independent track |
| Phase 3: Health Checks | `/health/live`, `/health/ready`, `onHealthCheck()` | **Already implemented** |
| Phase 3: Shutdown Timeout | `shutdownTimeout` option | **Already implemented** |
| Phase 3: Security Defaults | CORS `origin: false` | **Already implemented** |
| Phase 4: DevTools | CLASS_KIND, metrics, dependencies in `/_debug` | **Container tracking implemented**, SSE stream needed |
| Phase 4: HMR Improvements | **V3 reactive container + Vite plugin** | **The main new work** |
| Phase 4: Typegen | `kick typegen` command | Future |
| Phase 4: Vite Plugin | **@forinda/kickjs-vite** | **The main new work** |

**Key realization:** Most of Phase 1 and Phase 3 from the original plan are **already done**. The remaining work is:
1. **@forinda/kickjs-vite plugin** (the big piece)
2. **Reactive container** (connecting `reactivity.ts` to `container.ts`)
3. **DevTools SSE** (replacing polling with reactive subscriptions)
4. **Build system migration** (tsdown, independent track)

---

## 4. Dependency Graph of V3 Work

```
                    ┌───────────────────────┐
                    │  Connect reactivity.ts │
                    │  to container.ts       │
                    │  (Reactive registrations)│
                    └───────────┬───────────┘
                                │
              ┌─────────────────┼─────────────────┐
              │                 │                  │
    ┌─────────▼──────┐  ┌──────▼───────┐  ┌──────▼───────┐
    │ DevTools SSE   │  │ Vite plugin  │  │ Container    │
    │ /_debug/stream │  │ HMR plugin   │  │ .invalidate()│
    │ (subscribe to  │  │ (calls       │  │ .onChange()   │
    │  container     │  │  invalidate  │  │ (public API) │
    │  changes)      │  │  on file     │  └──────────────┘
    └────────────────┘  │  change)     │
                        └──────┬───────┘
                               │
                    ┌──────────▼───────────┐
                    │ Vite plugin:         │
                    │  core, virtuals,     │
                    │  module-discovery,   │
                    │  dev-server          │
                    └──────────┬───────────┘
                               │
                    ┌──────────▼───────────┐
                    │ CLI update:          │
                    │  kick dev uses       │
                    │  @forinda/kickjs-vite│
                    └──────────────────────┘
```

**Start with:** Reactive container (smallest change, biggest leverage).
**Then:** Vite plugin (core + virtual-modules + dev-server).
**Then:** HMR plugin (uses reactive container's invalidate()).
**Finally:** DevTools SSE + CLI integration.
