# Framework Benchmark Synthesis — KickJS Vite Architecture Guide

## Comparison Matrix

| Feature | NestJS | H3/Nuxt | React Router | AdonisJS | TanStack Start | Vinxi |
|---------|--------|---------|--------------|----------|----------------|-------|
| **Who owns HTTP port** | Express | Nitro/H3 | Vite | AdonisJS | Vite | Nitro/H3 |
| **Vite integration** | None (Webpack) | Plugin + IPC | Plugin (3900 LOC) | Middleware mode | Plugin (composed) | Multi-instance |
| **Server HMR** | Full restart | Handler swap | ssrLoadModule() | No server HMR | ssrLoadModule() | ssrLoadModule() |
| **DI container** | Full (InstanceWrapper) | None | None | @adonisjs/fold | None | None |
| **Module system** | @Module() decorator | Plugins | Virtual modules | Providers | Virtual modules | Router modes |
| **Reactivity** | None | None | None | None | None | None |
| **Build tool** | tsc/webpack | Vite (via Nitro) | Vite (dual env) | tsc + Vite (assets) | Vite (dual env) | Vite (multi-instance) |

## Key Insight: Nobody Does Backend Reactivity

**None of the analyzed frameworks use reactive proxies for backend objects.** This is a genuine innovation opportunity for KickJS. However, we can learn from their HMR strategies to inform how reactivity should work.

## The Three Viable Architectures for KickJS

### Option A: "React Router Pattern" — Vite Owns the Port
```
Vite Dev Server (port 3000)
  +-- Vite middleware (static assets, HMR)
  +-- KickJS middleware (configureServer hook)
        +-- ssrLoadModule('virtual:kickjs/app')
        +-- Fresh KickJS app on every request
        +-- Express adapter mounted as Vite middleware
```

**Pros:** Simplest HMR, Vite handles everything, proven at scale
**Cons:** KickJS loses control of HTTP layer, harder to integrate existing Express middleware
**Used by:** React Router, TanStack Start

### Option B: "AdonisJS Pattern" — KickJS Owns the Port
```
Express (port 3000)
  +-- KickJS middleware pipeline
  +-- Vite middleware (middlewareMode: true)
        +-- Static assets, HMR (separate WS port)
  +-- KickJS route handlers
```

**Pros:** Full control of HTTP, simpler mental model, existing Express middleware works
**Cons:** No automatic server HMR (need manual invalidation or process restart)
**Used by:** AdonisJS

### Option C: "Vinxi Pattern" — Nitro/H3 Coordinator with Multi-Vite
```
H3/Nitro Dev Server (port 3000)
  +-- /api/* --> KickJS HTTP Router (Vite instance #1, server target)
  +-- /_debug/* --> DevTools Router (Vite instance #2, SPA target)  
  +-- / --> Client Router (Vite instance #3, browser target)
```

**Pros:** Maximum flexibility, clean separation, multiple build targets
**Cons:** Most complex, multiple Vite instances = more memory, H3 dependency
**Used by:** Vinxi (SolidStart, TanStack Start)

### Recommended: Hybrid of A + Reactive Proxies

Based on the research, the **recommended architecture** for KickJS:

```
Vite Dev Server (owns port in dev)
  |
  +-- configureServer() hook from @forinda/kickjs-vite plugin
  |
  +-- For each request:
  |     +-- ssrLoadModule('virtual:kickjs/app')  [auto-invalidated by Vite]
  |     +-- Bootstrap KickJS app (cached, invalidated on change)
  |     +-- Route through Express adapter
  |
  +-- Reactive layer (KickJS innovation):
  |     +-- Container registrations wrapped in reactive proxies
  |     +-- When Vite invalidates a module, dependent proxies notify subscribers
  |     +-- Adapters (DevTools, WebSocket) subscribe to changes
  |     +-- State that is "persistent" (DB connections, caches) preserved across reloads
  |
  +-- Production mode:
        +-- Express owns the port (no Vite)
        +-- Reactive proxies disabled (direct references)
        +-- Standard Node.js server
```

## How Reactivity Should Work (Informed by Research)

### Inspiration Sources

1. **H3's `dynamicEventHandler()`** — mutable handler with `.set()` for atomic swap
2. **Nuxt's invalidation graph** — mark file + all importers as invalid
3. **React Router's `ssrLoadModule()`** — fresh code per request, Vite handles invalidation
4. **Vinxi's manifest proxy** — lazy property access triggers fresh resolution

### Proposed Reactive Container Design

```typescript
// Wrap container registrations in reactive proxies
class ReactiveContainer extends Container {
  private subscribers = new Map<string, Set<Subscriber>>()
  
  register(token, provider) {
    const registration = super.register(token, provider)
    return new Proxy(registration, {
      set: (target, prop, value) => {
        target[prop] = value
        this.notify(token) // Notify all subscribers
        return true
      }
    })
  }
  
  // Vite plugin calls this when a module is invalidated
  invalidate(moduleId: string) {
    const affected = this.findRegistrationsByModule(moduleId)
    for (const token of affected) {
      this.reResolve(token) // Re-import and re-register
      this.notify(token)    // Notify subscribers
    }
  }
  
  subscribe(token: string, callback: () => void): Unsubscribe {
    // DevTools, WebSocket adapters, etc. subscribe here
  }
}
```

### Persistent State Across Reloads

```typescript
// Mark registrations that should survive HMR
@Service({ persistent: true })
class DatabaseConnection {
  // This instance is preserved across module reloads
  // Only re-created if the class itself changes
}

@Service() // Default: re-created on module change
class UserController {
  @Autowired() db: DatabaseConnection // Gets the preserved instance
}
```

### Adapter Subscription Pattern

```typescript
// DevTools adapter subscribes to container changes
class DevToolsAdapter implements AppAdapter {
  beforeStart({ container }) {
    container.subscribe('*', (token, event) => {
      this.sseClients.forEach(client => {
        client.send({ type: 'container:change', token, event })
      })
    })
  }
}
```

## Virtual Module Contract for KickJS Vite Plugin

```typescript
// virtual:kickjs/app — The main entry point
export const app = bootstrap({
  modules: [/* auto-discovered from src/modules/ */],
  middleware: [/* from kick.config.ts */],
})

// virtual:kickjs/modules — Auto-discovered modules
export const modules = [
  () => import('./src/modules/users/users.module'),
  () => import('./src/modules/posts/posts.module'),
]

// virtual:kickjs/manifest — Container registry metadata
export const manifest = {
  services: [{ token: 'UserService', module: 'users', ... }],
  controllers: [{ token: 'UserController', routes: [...], ... }],
}
```

## Implementation Phases (Mapped to Issue #85)

### Phase 1: ssrLoadModule() Integration (replaces current HMR approach)
- Create `@forinda/kickjs-vite` plugin using `configureServer()` hook
- Use `ssrLoadModule('virtual:kickjs/app')` for fresh app per request
- Preserve DB connections and caches across reloads (persistent registry)

### Phase 2: Reactive Container
- Wrap `Container` in reactive proxy layer
- Invalidation tracking: module ID → affected tokens
- Subscriber system for adapters (DevTools SSE, WebSocket)

### Phase 3: Virtual Module Discovery
- Vite `transform()` hook scans for decorators
- Generates `virtual:kickjs/modules` from file system
- `virtual:kickjs/manifest` for devtools

### Phase 4: Production Mode
- Express owns port, no Vite
- Reactive proxies compile away (direct references)
- Pre-built module registry (no scanning)

---

## Patterns Worth Adopting (Summary)

| From | Pattern | Why |
|------|---------|-----|
| React Router | `ssrLoadModule()` for live code | Simplest HMR, Vite handles invalidation |
| React Router | Child compiler for analysis | Decorator scanning without polluting main build |
| React Router | Virtual modules as contract | Clean boundary between Vite and framework |
| H3 | `dynamicEventHandler()` | Atomic handler swap for zero-downtime reload |
| H3 | Symbol-keyed storage | Safe internal properties on shared objects |
| Nuxt | Invalidation graph walking | Module change → walk importers → re-resolve |
| Nuxt | IPC binary protocol | If KickJS needs separate compilation server |
| NestJS | Distance-based module ordering | Deterministic lifecycle hook execution |
| NestJS | WeakMap for request context | Auto-GC of request-scoped instances |
| NestJS | Barrier pattern | Synchronize async DI resolution |
| AdonisJS | Three-phase lifecycle | register/boot/ready separation |
| AdonisJS | Middleware mode Vite | `middlewareMode: true` when framework owns port |
| AdonisJS | Config providers | Deferred resolution until boot |
| TanStack | Server function RPC | Compile-time environment-specific code |
| TanStack | Import protection | Prevent server code leaking to client |
| TanStack | Composed plugin array | Plugin per concern, composed together |
| Vinxi | Multi-router architecture | Separate build targets per concern |
| Vinxi | Router modes | Typed build target definitions |
| Vinxi | Worker thread support | Isolate heavy computation |
| Vinxi | Stack pattern | Composable app configuration |
