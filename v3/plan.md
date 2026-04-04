# KickJS v3 Implementation Plan

> **Context:** The initial Vite plugin attempt (commits on `feat/vite-hmr-architecture`) failed because
> we tried to split the HTTP server from Vite, and mounting Express on Vite had issues. This plan
> is informed by benchmarking 6 frameworks (NestJS, H3/Nuxt, React Router, AdonisJS, TanStack Start,
> Vinxi) to find patterns that actually work. See `bench-mark/SYNTHESIS.md` for the full comparison.

---

## What Went Wrong Before

1. **Port conflict:** Express and Vite both wanted to own port 3000. We tried having Express own it
   and Vite be internal-only, but Vite's HMR WebSocket and middleware assumed it was the primary server.

2. **Middleware mode killed httpServer:** Running Vite in `middlewareMode: true` makes
   `viteServer.httpServer = null`. This broke WsAdapter, Socket.IO, and any library that needs
   `server.on('upgrade', ...)`. This was the **main blocker**.

3. **Middleware mode confusion:** Integrating Vite's Connect middleware into Express isn't
   straightforward — error handling, response lifecycle, and ordering all clash.

4. **Full rebuild on every change:** `Container.reset()` replays ALL registrations on every file
   change. With 50+ services, this is slow and fragile.

5. **Missing virtual modules:** Without virtual modules, there's no way for Vite to know what
   KickJS modules exist. Module discovery was manual (import in `src/modules/index.ts`).

## How V3 Fixes Each Problem

| Problem | V3 Solution | Pattern From |
|---------|-------------|--------------|
| Port conflict | Vite owns the port. Express is middleware via `configureServer()` post-hook. | React Router, TanStack |
| httpServer is null | **Don't use middlewareMode.** Vite creates the server. `viteServer.httpServer` is real. Stored on `globalThis.__kickjs_httpServer`. WsAdapter attaches to it. Zero adapter changes. | Vinxi (`listener.server.on('upgrade', ...)`) |
| Connect/Express clash | Express runs as post-middleware, not alongside. Vite handles its routes first, KickJS handles the rest. | React Router (same pattern) |
| Full rebuild | `ssrLoadModule()` returns fresh code per request. Selective `container.invalidate()` only clears changed tokens. | React Router + Nuxt |
| No virtual modules | `virtual:kickjs/app` auto-generates imports from discovered `@Module` classes. | React Router, TanStack, Vinxi |

## What We Learned from the Benchmarks

| Lesson | Source | Implication |
|--------|--------|-------------|
| **Vite should own the port in dev** | React Router, TanStack Start | Don't fight it. Express becomes middleware on Vite's server. |
| **ssrLoadModule() is the HMR mechanism** | React Router, TanStack, Vinxi | Every request gets fresh server code. No manual Container.reset() needed. |
| **Virtual modules are the integration point** | React Router (3), TanStack (3+), Vinxi (per-router) | Generate `virtual:kickjs/app` that auto-imports all modules. |
| **Plugin = array of focused sub-plugins** | React Router (14), TanStack (10), Vinxi (per-router) | Each sub-plugin does one thing. Compose them. |
| **Persistent state via globalThis** | React Router, Vinxi | DB connections, Redis clients go on `globalThis.__kickjs`. Survive module re-evaluation. |
| **dynamicEventHandler for handler swap** | H3/Nuxt | Atomic swap of the request handler, no listener removal. |
| **Nobody does backend reactivity** | All 6 frameworks | This is KickJS's unique innovation. But build it on proven HMR patterns first. |

---

## The Plan: 5 Steps, Incrementally Shippable

### Step 1: Persistent State Layer (1-2 days)

**Goal:** DB connections and manual registrations survive module re-evaluation without `Container.reset()` replay.

**Why first:** This is the foundation. Without it, nothing else works — every HMR cycle drops connections.

**Changes:**

| File | Change |
|------|--------|
| `packages/core/src/container.ts` | Add `persistent` flag to Registration. `registerFactory()` and `registerInstance()` set `persistent: true`. `invalidate(token)` skips persistent registrations. |
| `packages/core/src/container.ts` | New `static persistentStore` on globalThis — survives module re-evaluation (not just `Container.reset()`, but full re-import). |
| `packages/http/src/application.ts` | In `rebuild()`, move persistent registrations to new container instead of replaying factory lists. |

**Pattern from:** React Router (`globalThis` for state), Vinxi (`globalThis.app`, `globalThis.MANIFEST`)

```typescript
// The key insight: globalThis survives Vite module re-evaluation
// When ssrLoadModule() re-evaluates src/index.ts, globalThis persists

// In container.ts:
class Container {
  private static get persistentStore(): Map<any, any> {
    if (!globalThis.__kickjs_persistent) {
      globalThis.__kickjs_persistent = new Map()
    }
    return globalThis.__kickjs_persistent
  }
  
  registerFactory(token, factory, scope) {
    const existing = Container.persistentStore.get(token)
    if (existing) {
      // Reuse existing instance (DB connection etc.)
      this.registrations.set(token, { ...existing, persistent: true })
      return
    }
    const instance = factory()
    Container.persistentStore.set(token, instance)
    this.registrations.set(token, createReg({ target: token, scope, instance, persistent: true }))
  }
}
```

**Verification:**
- `pnpm test` passes
- DB adapter registers connection → file change → connection is reused (not dropped)

---

### Step 2: @forinda/kickjs-vite Plugin — Core + Dev Server (3-5 days)

**Goal:** `kick dev` uses a proper Vite plugin. Vite owns the port. Express is middleware.

**Why second:** This replaces the inline Vite setup in `run.ts` with a real plugin that can be extended.

**New package: `packages/vite/`**

```
packages/vite/
  package.json
  tsconfig.json
  vite.config.ts (or tsdown.config.ts)
  src/
    index.ts            → export { kickjsVitePlugin }
    plugin.ts           → kickjsVitePlugin() returns Plugin[]
    core-plugin.ts      → config hook: appType custom, SSR env, optimizeDeps
    dev-server.ts       → configureServer: mount Express on Vite
    virtual-modules.ts  → virtual:kickjs/app resolution
```

**core-plugin.ts:**
```typescript
export function kickjsCorePlugin(ctx: PluginContext): Plugin {
  return {
    name: 'kickjs:core',
    config(config, { command }) {
      return {
        appType: 'custom',
        environments: {
          ssr: {
            dev: { optimizeDeps: { /* pre-bundle common deps */ } },
          },
        },
        // Don't clear screen — KickJS logs route table on startup
        clearScreen: false,
      }
    },
  }
}
```

**dev-server.ts — The critical piece:**
```typescript
export function kickjsDevServerPlugin(ctx: PluginContext): Plugin {
  let currentApp: any = null
  
  return {
    name: 'kickjs:dev-server',
    configureServer(server) {
      return () => {
        // Post-middleware: runs after Vite's own static/HMR middleware
        server.middlewares.use(async (req, res, next) => {
          try {
            // ssrLoadModule returns fresh code if source changed
            const mod = await server.environments.ssr.runner.import(
              'virtual:kickjs/app'
            )
            
            // mod.app is an Express instance from bootstrap()
            if (mod.app?.handle) {
              mod.app.handle(req, res, (err?: any) => {
                if (err) return next(err)
                next() // Not handled by KickJS
              })
            } else {
              next()
            }
          } catch (err) {
            server.ssrFixStacktrace(err as Error)
            next(err)
          }
        })
      }
    },
  }
}
```

**virtual-modules.ts:**
```typescript
export function kickjsVirtualModulesPlugin(ctx: PluginContext): Plugin {
  return {
    name: 'kickjs:virtual-modules',
    resolveId(id) {
      if (id === 'virtual:kickjs/app') return '\0virtual:kickjs/app'
    },
    async load(id) {
      if (id !== '\0virtual:kickjs/app') return
      
      // Read the user's entry file and re-export the app
      // This is the simplest version — Step 4 adds auto-discovery
      return `
        import '${ctx.entryFile}'
        export { app } from '${ctx.entryFile}'
      `
    },
  }
}
```

**dev-server.ts — httpServer piping (the critical piece for Socket.IO etc.):**

The initial Vite plugin attempt failed because `middlewareMode: true` makes `httpServer` null.
Libraries like Socket.IO, KickJS's `WsAdapter`, GraphQL subscriptions all need the raw `http.Server`.

**Solution:** Don't use `middlewareMode`. Vite creates the server. We grab `viteServer.httpServer`
and pipe it to adapters via `globalThis.__kickjs_httpServer`.

From Vite's source (`packages/vite/src/node/server/index.ts:315-317`):
```typescript
httpServer: HttpServer | null  // null in middleware mode, REAL server otherwise
```

```typescript
// packages/vite/src/dev-server.ts
export function kickjsDevServerPlugin(ctx: PluginContext): Plugin {
  return {
    name: 'kickjs:dev-server',
    configureServer(viteServer) {
      // ━━━ THE KEY ━━━
      // Store the REAL http.Server where Application.start() can find it.
      // This is what WsAdapter, Socket.IO, GraphQL WS, etc. will attach to.
      globalThis.__kickjs_httpServer = viteServer.httpServer

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

**Application.start() detects dev vs prod:**
```typescript
// packages/http/src/application.ts — enhanced
async start(): Promise<void> {
  await this.setup()

  if (globalThis.__kickjs_httpServer) {
    // DEV: Vite created the server — reuse it
    this.httpServer = globalThis.__kickjs_httpServer
  } else {
    // PROD: Create our own
    this.httpServer = http.createServer(this.app)
    await new Promise<void>((resolve) => {
      this.httpServer!.listen(port, () => resolve())
    })
  }

  // SAME adapter flow — adapters always get the real httpServer
  for (const adapter of this.adapters) {
    await this.callHook(adapter.afterStart?.bind(adapter), this.adapterCtx(this.httpServer!))
    // WsAdapter gets: server.on('upgrade', ...)  ← WORKS (real http.Server)
    // Socket.IO gets: new Server(httpServer)      ← WORKS
  }
}
```

**WsAdapter needs ZERO changes.** It already does `server.on('upgrade', ...)` — the server
is real in both dev (Vite's) and prod (ours).

**CLI update (`packages/cli/src/commands/run.ts`):**
```typescript
async function startDevServer(entry: string, port?: string) {
  if (port) process.env.PORT = port
  
  const { createServer } = await import('vite')
  const server = await createServer({
    configFile: resolve('vite.config.ts'),
    // NOT middlewareMode! Vite creates the http.Server.
    // kickjsVitePlugin() in vite.config.ts stores httpServer on globalThis.
  })
  
  await server.listen(parseInt(port || process.env.PORT || '3000'))
  server.printUrls()
}
```

**User's vite.config.ts:**
```typescript
import { defineConfig } from 'vite'
import { kickjsVitePlugin } from '@forinda/kickjs-vite'
import swc from 'unplugin-swc'

export default defineConfig({
  plugins: [
    swc.vite({ tsconfigFile: 'tsconfig.json' }),
    kickjsVitePlugin({ entry: 'src/index.ts' }),
  ],
})
```

**User's src/index.ts changes:**
```typescript
import { bootstrap } from '@forinda/kickjs-http'
import { UserModule } from './modules/users/user.module'

// Export the Express app (not start the server — Vite owns the port in dev)
export const app = bootstrap({
  modules: [UserModule],
  middleware: [express.json()],
})

// In production, start normally
if (process.env.NODE_ENV === 'production') {
  app.start()
}
```

**Wait — this changes the user API?** Slightly. Currently `bootstrap()` calls `app.start()` internally.
In v3, `bootstrap()` returns the configured Express app WITHOUT listening. The CLI or Vite plugin
decides whether to listen. This is exactly what React Router and AdonisJS do.

**Pattern from:** React Router (`configureServer` post-hook), AdonisJS (framework owns startup)

**Verification:**
- `kick dev` starts Vite dev server on port 3000
- Requests to `/api/v1/users` hit KickJS controllers
- Vite static assets (HMR client) work
- File change → next request gets fresh code (no manual restart)

---

### Step 3: Reactive Container (2-3 days)

**Goal:** Connect the existing `reactivity.ts` to `container.ts`. DevTools subscribes via SSE instead of polling.

**Why third:** With the Vite plugin working, we can now add the reactive layer that makes HMR surgical.

**Changes:**

| File | Change |
|------|--------|
| `packages/core/src/container.ts` | Wrap registration events in reactive refs. Add `invalidate(token)` method. Add `onChange()` subscriber API. |
| `packages/core/src/container.ts` | `invalidate()` walks dependency graph: token → find dependents → invalidate them too. |
| `packages/devtools/src/adapter.ts` | New `GET /_debug/stream` SSE endpoint. Uses `container.onChange()` to push events. |

```typescript
// container.ts additions:

import { ref, type Ref } from './reactivity'

export class Container {
  // New: event stream for subscribers
  private changeListeners = new Set<(token: any, event: string) => void>()
  
  onChange(callback: (token: any, event: 'registered' | 'resolved' | 'invalidated') => void) {
    this.changeListeners.add(callback)
    return () => this.changeListeners.delete(callback)
  }
  
  private emit(token: any, event: string) {
    for (const listener of this.changeListeners) {
      listener(token, event)
    }
  }
  
  register(token, target, scope) {
    // ... existing logic ...
    this.emit(token, 'registered')
  }
  
  resolve(token) {
    // ... existing logic ...
    this.emit(token, 'resolved')
    return instance
  }
  
  invalidate(token: any) {
    const reg = this.registrations.get(token)
    if (!reg || reg.persistent) return
    
    reg.instance = undefined
    reg.resolveCount = 0
    this.emit(token, 'invalidated')
    
    // Walk dependency graph
    for (const [depToken, depReg] of this.registrations) {
      if (depReg.dependencies.includes(tokenName(token))) {
        this.invalidate(depToken)
      }
    }
  }
}
```

**DevTools SSE:**
```typescript
// packages/devtools/src/adapter.ts — new endpoint
app.get('/_debug/stream', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  })
  
  const unsub = container.onChange((token, event) => {
    res.write(`data: ${JSON.stringify({ token: tokenName(token), event, timestamp: Date.now() })}\n\n`)
  })
  
  req.on('close', unsub)
})
```

**Verification:**
- `container.invalidate('UserService')` clears instance + dependents
- DevTools `/_debug/stream` emits events on container changes
- No polling — real-time updates

---

### Step 4: Module Auto-Discovery via Vite transform() (2-3 days)

**Goal:** Vite plugin auto-discovers `@Controller` and `@Module` classes. No manual barrel files.

**Why fourth:** With the plugin and reactive container working, auto-discovery removes the last
manual step (maintaining `src/modules/index.ts`).

**New file: `packages/vite/src/module-discovery.ts`**

```typescript
export function kickjsModuleDiscoveryPlugin(ctx: PluginContext): Plugin {
  const discoveredModules = new Map<string, string>() // filePath → moduleName
  
  return {
    name: 'kickjs:module-discovery',
    
    // Scan each file for @Module() decorator
    transform(code, id) {
      if (!id.endsWith('.module.ts') && !id.endsWith('.module.js')) return
      if (!code.includes('@Module') && !code.includes('AppModule')) return
      
      // Extract class name via regex (fast, no AST needed)
      const match = code.match(/export\s+class\s+(\w+Module)/)
      if (match) {
        discoveredModules.set(id, match[1])
      }
      return null // Don't transform, just observe
    },
    
    // Override virtual module to include discovered modules
    load(id) {
      if (id !== '\0virtual:kickjs/app') return
      
      const imports = [...discoveredModules.entries()]
        .map(([path, name], i) => `import { ${name} } from '${path}'`)
        .join('\n')
      
      const moduleList = [...discoveredModules.values()].join(', ')
      
      return `
        ${imports}
        import { bootstrap } from '@forinda/kickjs-http'
        
        export const app = bootstrap({
          modules: [${moduleList}],
        })
      `
    },
    
    // When a module file changes, invalidate the virtual module
    handleHotUpdate({ file, server }) {
      if (file.endsWith('.module.ts') || file.endsWith('.module.js')) {
        const mod = server.moduleGraph.getModuleById('\0virtual:kickjs/app')
        if (mod) server.moduleGraph.invalidateModule(mod)
      }
    },
  }
}
```

**Pattern from:** React Router (child compiler for route analysis), TanStack (route file detection), Vinxi (fs-watcher plugin)

**Verification:**
- Create `src/modules/new-feature/new-feature.module.ts` → auto-discovered on next request
- Delete module file → removed from virtual module
- No need to edit `src/modules/index.ts` barrel file

---

### Step 5: HMR Plugin — Selective Invalidation (2-3 days)

**Goal:** When a single service file changes, only that service and its dependents are invalidated —
not the entire container.

**New file: `packages/vite/src/hmr-plugin.ts`**

```typescript
export function kickjsHmrPlugin(ctx: PluginContext): Plugin {
  // Map: file path → DI tokens defined in that file
  const fileTokenMap = new Map<string, string[]>()
  
  return {
    name: 'kickjs:hmr',
    
    // Track which tokens are defined in which files
    transform(code, id) {
      if (!id.includes('/modules/') && !id.includes('/services/')) return
      
      const tokens: string[] = []
      // Match @Service() class Foo, @Controller() class Bar, etc.
      const regex = /@(?:Service|Controller|Repository|Injectable|Component)\(\)\s*\n?\s*(?:export\s+)?class\s+(\w+)/g
      let match
      while ((match = regex.exec(code)) !== null) {
        tokens.push(match[1])
      }
      
      if (tokens.length > 0) {
        fileTokenMap.set(id, tokens)
      }
      return null
    },
    
    handleHotUpdate({ file, server }) {
      const tokens = fileTokenMap.get(file)
      if (!tokens || tokens.length === 0) return
      
      // Selective invalidation via the reactive container
      const container = globalThis.__kickjs_container
      if (container) {
        for (const token of tokens) {
          container.invalidate(token)
        }
      }
      
      // Invalidate virtual module so next ssrLoadModule() picks up changes
      const vmod = server.moduleGraph.getModuleById('\0virtual:kickjs/app')
      if (vmod) server.moduleGraph.invalidateModule(vmod)
      
      // Send custom HMR event (DevTools can listen to this)
      server.hot.send({
        type: 'custom',
        event: 'kickjs:hmr',
        data: { tokens, file },
      })
      
      console.log(`  HMR: invalidated ${tokens.join(', ')}`)
    },
  }
}
```

**Pattern from:** React Router (`handleHotUpdate` + virtual module invalidation), H3/Nuxt (invalidation graph walk), TanStack (detection patterns via regex)

**Verification:**
- Change `UserService` → only `UserService` + `UserController` (dependent) invalidated
- `PostService` untouched (no dependency on UserService)
- DevTools SSE shows `{ token: 'UserService', event: 'invalidated' }`
- Next request creates fresh UserService instance
- DB connection (persistent) not affected

---

## Timeline

```
Step 1: Persistent State        ████  (1-2 days)
Step 2: Vite Plugin + Dev Server ██████████  (3-5 days)  ← biggest piece
Step 3: Reactive Container       ██████  (2-3 days)
Step 4: Module Auto-Discovery    ██████  (2-3 days)
Step 5: HMR Selective Invalidation ██████  (2-3 days)
                                 ─────────────────────
                                 Total: 11-16 days

Each step is independently testable and shippable.
Steps 3-5 can partially overlap (3 unblocks 5, but 4 is independent).
```

---

### Step 6: Batched Update Subscriptions (1 day)

**Goal:** When `kick g module users` creates 10+ files at once, subscribers (Swagger, DevTools)
get ONE update, not 10 rapid-fire updates that crash or cause stale intermediate states.

**The problem:**
```
kick g module users
  → creates user.module.ts      → Vite detects → HMR fires → Swagger re-fetches
  → creates user.controller.ts  → Vite detects → HMR fires → Swagger re-fetches
  → creates user.service.ts     → Vite detects → HMR fires → Swagger re-fetches
  → creates user.repository.ts  → Vite detects → HMR fires → Swagger re-fetches
  → creates user.dtos.ts        → Vite detects → HMR fires → Swagger re-fetches
  → creates user.module.ts index update → ...
  ... 10+ files = 10+ HMR cycles = 10+ spec rebuilds = flicker/crashes
```

**Solution: Debounced batching in the HMR plugin.**

```typescript
// packages/vite/src/hmr-plugin.ts — enhanced

export function kickjsHmrPlugin(ctx: PluginContext): Plugin {
  let pendingTokens = new Set<string>()
  let debounceTimer: ReturnType<typeof setTimeout> | null = null
  const DEBOUNCE_MS = 150  // Wait 150ms after last file change before notifying

  return {
    name: 'kickjs:hmr',

    handleHotUpdate({ file, server }) {
      const tokens = fileTokenMap.get(file)
      if (!tokens?.length) return

      // Accumulate changed tokens
      for (const t of tokens) pendingTokens.add(t)

      // Debounce: only fire after 150ms of quiet
      if (debounceTimer) clearTimeout(debounceTimer)
      debounceTimer = setTimeout(() => {
        const batch = [...pendingTokens]
        pendingTokens.clear()

        // Invalidate all changed tokens at once
        const container = globalThis.__kickjs_container
        if (container) {
          for (const token of batch) {
            container.invalidate(token)
          }
        }

        // ONE virtual module invalidation
        const vmod = server.moduleGraph.getModuleById('\0virtual:kickjs/app')
        if (vmod) server.moduleGraph.invalidateModule(vmod)

        // ONE notification to Swagger UI / DevTools
        server.hot.send({
          type: 'custom',
          event: 'kickjs:hmr',
          data: { tokens: batch, timestamp: Date.now() },
        })

        console.log(`  HMR: invalidated ${batch.length} tokens: ${batch.join(', ')}`)
      }, DEBOUNCE_MS)

      // Tell Vite we handled it (don't do default full-page reload)
      return []
    },
  }
}
```

**The same debouncing in the container's `onChange()`:**

```typescript
// packages/core/src/container.ts — batched change notifications

export class Container {
  private pendingChanges: Array<{ token: any; event: string }> = []
  private notifyTimer: ReturnType<typeof setTimeout> | null = null

  private emit(token: any, event: string) {
    this.pendingChanges.push({ token, event })

    if (this.notifyTimer) clearTimeout(this.notifyTimer)
    this.notifyTimer = setTimeout(() => {
      const batch = [...this.pendingChanges]
      this.pendingChanges = []

      for (const listener of this.changeListeners) {
        listener(batch)  // Listener receives array of changes, not one at a time
      }
    }, 50)  // 50ms debounce for container-level events
  }
}
```

**Result:**
```
kick g module users (creates 10 files)
  → Vite detects 10 file changes over ~200ms
  → HMR plugin accumulates: [UserModule, UserController, UserService, ...]
  → After 150ms quiet: ONE invalidation batch
  → ONE virtual module re-generation
  → ONE Swagger UI refresh (spec fetched once, all new routes visible)
  → ONE DevTools SSE event (dashboard updates once)
```

**Pattern from:** Vite itself debounces file watcher events. Nuxt batches template invalidations. Standard practice in reactive systems (Vue's `nextTick`, React's batched state updates).

**Verification:**
- `kick g module products` → Swagger UI shows new routes after ONE refresh
- No intermediate broken states (half-registered module)
- DevTools shows single "10 tokens invalidated" event, not 10 separate events
- Console shows: `HMR: invalidated 6 tokens: ProductModule, ProductController, ...`

---

---

### Step 7: Inertia-Like SPA Support — `@forinda/kickjs-inertia` (Future, 5-7 days)

**Goal:** Serve a full SPA (React/Vue/Svelte) from KickJS controllers without building a
separate API. Controllers return page components + props. The browser gets a full SPA with
client-side navigation, but all routing and data loading lives on the server.

**What is Inertia?**

Inertia.js is a protocol (not a framework) that eliminates the API layer between server and SPA:

```
Traditional:    Server → JSON API → Client fetches → SPA renders
Inertia:        Server → { component: 'Users/Index', props: { users } } → Client renders
```

- First request: server returns full HTML (SSR'd component + hydration props)
- Subsequent navigations: client sends `X-Inertia: true` header → server returns JSON page object
- Client swaps component without full page reload (SPA-like UX)
- Server-side redirects, validation, flash messages — all work through the protocol

**Why it fits KickJS perfectly:**

KickJS is already decorator-driven with controllers. Inertia just changes what controllers return:

```typescript
// BEFORE (API mode):
@Controller('/users')
class UserController {
  @Get('/')
  async index(ctx: RequestContext) {
    const users = await this.userService.findAll()
    return ctx.json({ users })  // Returns JSON for API consumers
  }
}

// AFTER (Inertia mode):
@Controller('/users')
class UserController {
  @Get('/')
  async index(ctx: RequestContext) {
    const users = await this.userService.findAll()
    return ctx.inertia('Users/Index', { users })  // Returns SPA page!
    //                  ^^^^^^^^^^^   ^^^^^^^^^
    //                  Component     Props (serialized, type-safe)
  }
}
```

**Architecture — How It Connects to V3:**

```
┌────────────────────────────────────────────────────────────────┐
│                    Vite Dev Server (port 3000)                  │
│                                                                │
│  ┌──────────────────┐  ┌─────────────────────────────────────┐│
│  │ Client Vite Env  │  │ SSR Vite Env                        ││
│  │ (browser target) │  │ (server target)                     ││
│  │                  │  │                                     ││
│  │ React/Vue/Svelte │  │ KickJS controllers                  ││
│  │ page components  │  │   ↓                                 ││
│  │ HMR for UI       │  │ ctx.inertia('Users/Index', props)   ││
│  │                  │  │   ↓                                 ││
│  │ ← hydrates from  │  │ InertiaAdapter:                     ││
│  │   server render   │  │   First request → SSR render HTML   ││
│  │                  │  │   X-Inertia → JSON page response    ││
│  └──────────────────┘  └─────────────────────────────────────┘│
└────────────────────────────────────────────────────────────────┘

Request Flow:

1. GET /users (first visit, no X-Inertia header)
   → Controller: ctx.inertia('Users/Index', { users: [...] })
   → InertiaAdapter intercepts response
   → SSR: ssrLoadModule('Users/Index') → renderToString(component, props)
   → Returns full HTML: <html>...<div id="app">{SSR'd content}</div>
     <script>__INERTIA_PAGE__ = { component: 'Users/Index', props: {...} }</script>
     <script type="module" src="/src/app.tsx"></script>  ← Vite client entry
     </html>
   → Browser hydrates SPA

2. Click link → GET /users/123 (X-Inertia: true, X-Inertia-Version: abc123)
   → Controller: ctx.inertia('Users/Show', { user: {...} })
   → InertiaAdapter sees X-Inertia header
   → Returns JSON: { component: 'Users/Show', props: { user }, url: '/users/123', version: 'abc123' }
   → Client-side Inertia router swaps component (no full page reload)

3. POST /users (form submit, X-Inertia: true)
   → Controller: creates user, then ctx.inertia.redirect('/users/123')
   → InertiaAdapter returns 303 redirect
   → Client follows redirect → gets JSON page for /users/123
```

**Package Structure (informed by AdonisJS Inertia at `/home/forinda/dev/open-source/adonis-js-inertia`):**

```
packages/inertia/
  src/
    index.ts
    inertia.ts               → Core Inertia class (per-request instance, render logic)
    inertia-adapter.ts       → AppAdapter (lifecycle hooks, version tracking)
    inertia-middleware.ts     → Protocol handling (409, 303, validation errors)
    server-renderer.ts       → SSR via Vite ModuleRunner (dev) or pre-built bundle (prod)
    props.ts                 → defer(), optional(), always(), merge() — Symbol-branded helpers
    symbols.ts               → DEFERRED_PROP, OPTIONAL_PROP, ALWAYS_PROP, TO_BE_MERGED
    define-config.ts         → defineInertiaConfig() with defaults
    types.ts                 → InertiaPage, InertiaConfig, SharedData, PageObject
    context-extension.ts     → Adds ctx.inertia to RequestContext
    page-indexer.ts          → Scan src/pages/ → generate typed InertiaPages interface
    client/
      helpers.ts             → resolvePageComponent() for lazy imports
      react/
        index.tsx            → createInertiaApp() wrapper
        link.tsx             → <Link route="users.show" routeParams={{ id: 1 }}>
        form.tsx             → <Form route="users.store"> (type-safe submission)
        use-router.ts        → useRouter() hook for programmatic navigation
      vue/
        index.ts, link.ts, form.ts, use-router.ts  → Same API for Vue 3
      vite.ts                → Vite plugin for client + SSR builds
```

**Core Inertia Class — Per-Request Instance (from AdonisJS `src/inertia.ts`):**

```typescript
// packages/inertia/src/inertia.ts

export class Inertia {
  #ctx: RequestContext
  #config: InertiaConfig
  #sharedStateProviders: Array<() => Promise<Record<string, any>>> = []
  #cachedVersion: string | null = null
  
  constructor(ctx: RequestContext, config: InertiaConfig) {
    this.#ctx = ctx
    this.#config = config
  }
  
  /** Add shared data available on every page (auth user, flash, etc.) */
  share(data: Record<string, any> | (() => Promise<Record<string, any>>)): this {
    this.#sharedStateProviders.push(
      typeof data === 'function' ? data : async () => data
    )
    return this
  }
  
  /** Main render method — returns HTML or JSON based on request headers */
  async render(component: string, pageProps?: Record<string, any>, viewProps?: any) {
    const requestInfo = this.#parseRequestHeaders()
    
    // Build props: shared state + page props + resolve lazy/deferred
    const props = await this.#buildPageProps(component, requestInfo, pageProps)
    
    const pageObject: PageObject = {
      component,
      props,
      url: this.#ctx.req.url,
      version: this.getVersion(),
      deferredProps: this.#collectDeferredGroups(pageProps),
      mergeProps: this.#collectMergeProps(pageProps),
    }
    
    // ── Decision point (same as AdonisJS inertia.ts:520-542) ──
    if (requestInfo.isInertiaRequest) {
      // Subsequent navigation → JSON response
      this.#ctx.res.setHeader('X-Inertia', 'true')
      return this.#ctx.json(pageObject)
    }
    
    if (await this.#ssrEnabled(component)) {
      // First visit + SSR enabled → full HTML with SSR'd content
      return this.#renderWithSSR(pageObject, viewProps)
    }
    
    // First visit, no SSR → shell HTML for client-side rendering
    return this.#renderClientSide(pageObject, viewProps)
  }
  
  /** Asset version — MD5 of Vite manifest (same as AdonisJS) */
  getVersion(): string {
    if (this.#cachedVersion) return this.#cachedVersion
    // Dev: use reactive container version (bumps on controller change)
    // Prod: MD5 of Vite manifest
    this.#cachedVersion = globalThis.__kickjs_inertia_version ?? 'dev'
    return this.#cachedVersion
  }
}
```

**SSR Renderer — Vite ModuleRunner (from AdonisJS `src/server_renderer.ts`):**

```typescript
// packages/inertia/src/server-renderer.ts

export class ServerRenderer {
  #runtime: ModuleRunner | null = null
  #ssrEnvironment: any = null
  
  async render(pageObject: PageObject): Promise<{ head: string[], body: string }> {
    if (globalThis.__kickjs_viteServer) {
      return this.#devRender(pageObject)
    }
    return this.#prodRender(pageObject)
  }
  
  // Dev: Vite's ModuleRunner (newer than ssrLoadModule, used by AdonisJS)
  async #devRender(pageObject: PageObject) {
    const viteServer = globalThis.__kickjs_viteServer
    const currentEnv = viteServer.environments.ssr
    
    // Detect Vite restart — recreate runner if environment changed
    if (this.#ssrEnvironment !== currentEnv) {
      this.#ssrEnvironment = currentEnv
      const { createViteRuntime } = await import('vite')
      this.#runtime = await createViteRuntime(currentEnv, { hmr: { logger: false } })
    }
    
    const mod = await this.#runtime!.import(this.#config.ssr.entrypoint)
    return mod.default(pageObject)  // → { head: ['<title>...'], body: '<div>...' }
  }
  
  // Prod: pre-built SSR bundle
  async #prodRender(pageObject: PageObject) {
    const { pathToFileURL } = await import('node:url')
    const mod = await import(pathToFileURL(this.#config.ssr.bundle).href)
    return mod.default(pageObject)
  }
}
```

**Middleware — Protocol Handler (from AdonisJS `src/inertia_middleware.ts`):**

```typescript
// packages/inertia/src/inertia-middleware.ts

export function inertiaMiddleware(config: InertiaConfig) {
  return async (req, res, next) => {
    // Create per-request Inertia instance
    const ctx = req.__kickRequestContext
    ctx.inertia = new Inertia(ctx, config)
    
    // Call shared data providers (auth user, flash messages)
    if (config.share) {
      ctx.inertia.share(await config.share(ctx))
    }
    
    await next()
    
    // ── Post-handler protocol logic ──
    if (!req.headers['x-inertia']) return
    
    // Version mismatch → 409 Conflict (AdonisJS middleware:181-191)
    const clientVersion = req.headers['x-inertia-version']
    if (clientVersion && clientVersion !== ctx.inertia.getVersion()) {
      res.status(409).setHeader('X-Inertia-Location', req.url).end()
      return
    }
    
    // Mutation redirect: 302 → 303 for PUT/PATCH/DELETE (AdonisJS middleware:170-174)
    if (['PUT', 'PATCH', 'DELETE'].includes(req.method) && res.statusCode === 302) {
      res.statusCode = 303
    }
  }
}
```

**Prop Helpers — Symbol-Branded (from AdonisJS `src/props.ts`):**

```typescript
// packages/inertia/src/props.ts

const DEFERRED_PROP = Symbol.for('kickjs:inertia:deferred')
const OPTIONAL_PROP = Symbol.for('kickjs:inertia:optional')
const ALWAYS_PROP = Symbol.for('kickjs:inertia:always')
const TO_BE_MERGED = Symbol.for('kickjs:inertia:merge')

/** Prop computed lazily — only on partial reload when requested */
export function defer<T>(fn: () => T | Promise<T>, group?: string) {
  const prop = fn as any
  prop[DEFERRED_PROP] = true
  prop._group = group
  return prop
}

/** Prop only included when explicitly requested via X-Inertia-Partial-Data */
export function optional<T>(fn: () => T | Promise<T>) {
  const prop = fn as any
  prop[OPTIONAL_PROP] = true
  return prop
}

/** Prop always included, never filtered by partial reload */
export function always<T>(value: T) {
  const prop = { value, [ALWAYS_PROP]: true }
  return prop
}

/** Prop merged with existing client data instead of replaced */
export function merge<T>(value: T) {
  const prop = { value, [TO_BE_MERGED]: true }
  return prop
}
```

**Usage in controllers:**
```typescript
@Controller('/users')
class UserController {
  @Get('/')
  async index(ctx: RequestContext) {
    return ctx.inertia.render('Users/Index', {
      users: await this.userService.findAll(),        // Standard prop
      stats: defer(() => this.statsService.compute()), // Lazy — only on partial reload
      permissions: always(ctx.auth.permissions),       // Never filtered
      notifications: optional(() => this.notifService.recent()), // Only when requested
      infiniteScrollItems: merge(await this.getPage()), // Merged with existing client data
    })
  }
}
```

**InertiaAdapter — Hooks into V3 Reactive Container:**

```typescript
// packages/inertia/src/inertia-adapter.ts

export class InertiaAdapter implements AppAdapter {
  name = 'InertiaAdapter'
  #version = 'initial'
  
  constructor(private config: InertiaConfig) {}
  
  middleware(): AdapterMiddleware[] {
    return [{
      handler: inertiaMiddleware(this.config),
      phase: 'beforeRoutes',
    }]
  }
  
  beforeStart({ container }: AdapterContext): void {
    // ── Reactive version bumping ──
    // When any controller changes, bump the asset version.
    // Middleware will return 409 → client full-reloads → picks up new code.
    container.onChange((changes) => {
      const hasControllerChange = changes.some(c => c.kind === 'controller')
      if (hasControllerChange) {
        this.#version = Date.now().toString(36)
        globalThis.__kickjs_inertia_version = this.#version
      }
    })
  }
  
  afterStart({ server }: AdapterContext): void {
    // httpServer is available (Vite's or ours) — no issues
    // Inertia doesn't need the raw server, but other adapters alongside it do
  }
}
```

**Type Generation — Auto-Typed Page Components:**

```typescript
// packages/inertia/src/page-indexer.ts
// Scans src/pages/ and generates .kickjs/inertia-pages.d.ts

export function indexPages(config: { framework: 'react' | 'vue' | 'svelte', source?: string }) {
  const pagesDir = config.source ?? 'src/pages'
  const pages = glob.sync(`${pagesDir}/**/*.{tsx,vue,svelte}`)
  
  // Generate type declarations:
  // declare module '@forinda/kickjs-inertia' {
  //   interface InertiaPages {
  //     'Users/Index': { users: User[] }
  //     'Users/Show': { user: User }
  //   }
  // }
  
  // This makes ctx.inertia.render() type-safe:
  // ctx.inertia.render('Users/Index', { users })  ← TS checks props match!
  // ctx.inertia.render('Typo/Page', {})            ← TS ERROR: not in InertiaPages
}
```

**Vite Plugin Enhancement — Dual Environment:**

```typescript
// packages/vite/src/core-plugin.ts — enhanced for Inertia mode
config(userConfig, { command }) {
  const isInertia = ctx.config.mode === 'inertia'
  
  return {
    environments: {
      ssr: { /* KickJS controllers — always present */ },
      ...(isInertia ? {
        client: {
          // React/Vue/Svelte page components
          consumer: 'client',
          dev: {
            optimizeDeps: {
              include: ['react', 'react-dom', '@inertiajs/react']
            }
          },
          build: {
            outDir: 'build/public/assets',
            rollupOptions: { input: 'src/app.tsx' },
          }
        }
      } : {}),
    },
  }
}
```

**How It Connects to Everything We Built:**

| V3 Component | Inertia Usage |
|-------------|---------------|
| **httpServer piping** | WsAdapter + Inertia coexist — both use the same real httpServer |
| **Reactive container** | `container.onChange()` bumps asset version → 409 → stale clients reload |
| **Virtual modules** | `virtual:kickjs/pages` auto-discovers page components from `src/pages/` |
| **HMR batching** | `kick g module` creates 10 files → ONE version bump, ONE 409 check |
| **configureServer** | Client env serves React/Vue HMR, SSR env serves KickJS controllers |
| **Persistent state** | SSR renderer + ModuleRunner persist across HMR (warm, fast) |
| **Vite ModuleRunner** | AdonisJS uses `createViteRuntime()` — newer than `ssrLoadModule()` |

**User Experience:**

```bash
# Scaffold a new Inertia project
kick new my-app --template inertia-react

# Project structure:
src/
  modules/
    users/
      user.controller.ts    ← @Controller, returns ctx.inertia.render('Users/Index', { users })
      user.service.ts       ← @Service, business logic (same as API mode)
      user.module.ts        ← @Module (same as API mode)
  pages/                    ← NEW: React/Vue/Svelte page components
    Users/
      Index.tsx             ← Receives { users } as props
      Show.tsx              ← Receives { user } as props
      Create.tsx            ← Form with useForm() hook
    Layout.tsx              ← Shared layout
  app.tsx                   ← Inertia client entry (createInertiaApp)
  ssr.tsx                   ← SSR entry (renderToString)
kick.config.ts              ← { mode: 'inertia', spa: { framework: 'react' } }
```

```typescript
// src/pages/Users/Index.tsx
import { Link } from '@forinda/kickjs-inertia/react'

export default function UsersIndex({ users }: { users: User[] }) {
  return (
    <div>
      <h1>Users</h1>
      {users.map(user => (
        <Link key={user.id} route="users.show" routeParams={{ id: user.id }}>
          {user.name}
        </Link>
      ))}
    </div>
  )
}
// No API calls. No useEffect. No loading states.
// Props come from controller. Navigation is client-side.
// Link is type-safe (route name validated at compile time).
```

**Pattern from:**
- **AdonisJS `@adonisjs/inertia`** (`/home/forinda/dev/open-source/adonis-js-inertia`) — Core architecture: per-request Inertia instance, Symbol-branded props (defer/optional/always/merge), ServerRenderer with Vite ModuleRunner, middleware protocol handling (409/303), type generation from page components, React/Vue client helpers with type-safe routing
- **Laravel Inertia** — The original protocol design
- **Vinxi multi-router** — Separate client/SSR Vite environments
- **React Router SSR** — Dual build strategy (client + server)

---

### Step 8: Extract Reflect Metadata Utilities (1-2 days)

**Goal:** Replace 186 scattered `Reflect.defineMetadata()` / `Reflect.getMetadata()` calls across
24 files with typed utility functions. Single source of truth, easier to refactor, and enables
swapping the metadata backend later (e.g., Stage 3 decorators, or a WeakMap-based store).

**The problem — 186 raw calls across 24 files:**

```typescript
// This pattern repeats EVERYWHERE:
Reflect.defineMetadata(METADATA.CLASS_KIND, 'service', target)
Reflect.defineMetadata(METADATA.ROUTES, routes, target.constructor)
const routes: RouteDefinition[] = Reflect.getMetadata(METADATA.ROUTES, controllerClass) || []
const existing = Reflect.getMetadata(METADATA.METHOD_MIDDLEWARES, target.constructor, key) || []
Reflect.defineMetadata(METADATA.METHOD_MIDDLEWARES, [...existing, ...handlers], target.constructor, key)
```

Problems:
- Default values (`|| []`, `|| {}`, `|| new Map()`) are inconsistent
- No type safety on what metadata key expects what value type
- "Get, modify, set" accumulation pattern is error-prone
- If we ever change the metadata backend (Stage 3 decorators, WeakMap), 186 call sites to update

**5 repeating patterns found:**

| Pattern | Count | Example |
|---------|-------|---------|
| Define on class | ~40 | `Reflect.defineMetadata(KEY, value, target)` |
| Define on method | ~25 | `Reflect.defineMetadata(KEY, value, target.constructor, prop)` |
| Get from class (with default) | ~50 | `Reflect.getMetadata(KEY, target) \|\| []` |
| Get from method (with default) | ~35 | `Reflect.getMetadata(KEY, target, method) \|\| []` |
| Accumulate (get+push+set) | ~36 | Get existing array/map, append, set back |

**Solution: `packages/core/src/metadata.ts`**

```typescript
// packages/core/src/metadata.ts

import 'reflect-metadata'

// ── Typed Setters ─────────────────────────────────────────────

/** Set metadata on a class */
export function setClassMeta<T>(key: symbol | string, value: T, target: Function): void {
  Reflect.defineMetadata(key, value, target)
}

/** Set metadata on a method */
export function setMethodMeta<T>(
  key: symbol | string,
  value: T,
  target: Function,
  method: string,
): void {
  Reflect.defineMetadata(key, value, target, method)
}

// ── Typed Getters (with defaults) ─────────────────────────────

/** Get metadata from a class, with typed default */
export function getClassMeta<T>(key: symbol | string, target: Function, fallback: T): T {
  return Reflect.getMetadata(key, target) ?? fallback
}

/** Get metadata from a method, with typed default */
export function getMethodMeta<T>(
  key: symbol | string,
  target: Function,
  method: string,
  fallback: T,
): T {
  return Reflect.getMetadata(key, target, method) ?? fallback
}

/** Check if class has metadata */
export function hasClassMeta(key: symbol | string, target: Function): boolean {
  return Reflect.hasMetadata(key, target)
}

// ── Accumulate Patterns (get + append + set) ──────────────────

/** Push to an array stored in class metadata */
export function pushClassMeta<T>(key: symbol | string, target: Function, ...items: T[]): void {
  const existing: T[] = Reflect.getMetadata(key, target) ?? []
  Reflect.defineMetadata(key, [...existing, ...items], target)
}

/** Push to an array stored in method metadata */
export function pushMethodMeta<T>(
  key: symbol | string,
  target: Function,
  method: string,
  ...items: T[]
): void {
  const existing: T[] = Reflect.getMetadata(key, target, method) ?? []
  Reflect.defineMetadata(key, [...existing, ...items], target, method)
}

/** Set a key in a Map stored in class metadata */
export function setInClassMap<K, V>(
  key: symbol | string,
  target: Function,
  mapKey: K,
  mapValue: V,
): void {
  const existing: Map<K, V> = Reflect.getMetadata(key, target) ?? new Map()
  existing.set(mapKey, mapValue)
  Reflect.defineMetadata(key, existing, target)
}

/** Get a Map from class metadata */
export function getClassMap<K, V>(key: symbol | string, target: Function): Map<K, V> {
  return Reflect.getMetadata(key, target) ?? new Map()
}

/** Set a key in a Record stored in class metadata */
export function setInClassRecord<V>(
  key: symbol | string,
  target: Function,
  recKey: number | string,
  recValue: V,
): void {
  const existing: Record<string | number, V> = Reflect.getMetadata(key, target) ?? {}
  existing[recKey] = recValue
  Reflect.defineMetadata(key, existing, target)
}
```

**Before → After examples:**

```typescript
// ── decorators.ts ────────────────────────────────────────────

// BEFORE (5 lines of raw Reflect):
export function Service(options?: ServiceOptions): ClassDecorator {
  return (target: any) => {
    Reflect.defineMetadata(METADATA.CLASS_KIND, 'service', target)
    Reflect.defineMetadata(METADATA.INJECTABLE, true, target)
    Reflect.defineMetadata(METADATA.SCOPE, options?.scope ?? Scope.SINGLETON, target)
    registerInContainer(target, options?.scope ?? Scope.SINGLETON)
  }
}

// AFTER (cleaner, typed):
export function Service(options?: ServiceOptions): ClassDecorator {
  return (target: any) => {
    setClassMeta(METADATA.CLASS_KIND, 'service', target)
    setClassMeta(METADATA.INJECTABLE, true, target)
    setClassMeta(METADATA.SCOPE, options?.scope ?? Scope.SINGLETON, target)
    registerInContainer(target, options?.scope ?? Scope.SINGLETON)
  }
}


// ── Route decorator accumulation ─────────────────────────────

// BEFORE (get, push, set — error-prone):
const routes: RouteDefinition[] =
  Reflect.getMetadata(METADATA.ROUTES, target.constructor) || []
routes.push(routeDef)
Reflect.defineMetadata(METADATA.ROUTES, routes, target.constructor)

// AFTER (single call):
pushClassMeta(METADATA.ROUTES, target.constructor, routeDef)


// ── Middleware accumulation ───────────────────────────────────

// BEFORE:
const existing =
  Reflect.getMetadata(METADATA.METHOD_MIDDLEWARES, target.constructor, propertyKey) || []
Reflect.defineMetadata(
  METADATA.METHOD_MIDDLEWARES,
  [...existing, ...handlers],
  target.constructor,
  propertyKey,
)

// AFTER:
pushMethodMeta(METADATA.METHOD_MIDDLEWARES, target.constructor, propertyKey, ...handlers)


// ── Autowired Map accumulation ───────────────────────────────

// BEFORE:
const existing: Map<string, any> = Reflect.getMetadata(METADATA.AUTOWIRED, target) || new Map()
existing.set(propertyKey, token)
Reflect.defineMetadata(METADATA.AUTOWIRED, existing, target)

// AFTER:
setInClassMap(METADATA.AUTOWIRED, target, propertyKey, token)


// ── container.ts reads ───────────────────────────────────────

// BEFORE:
const paramTypes: Constructor[] = Reflect.getMetadata(METADATA.PARAM_TYPES, reg.target) || []
const injectTokens: Record<number, any> = Reflect.getMetadata(METADATA.INJECT, reg.target) || {}
const autowired = Reflect.getMetadata(METADATA.AUTOWIRED, target.prototype) || new Map()

// AFTER:
const paramTypes = getClassMeta<Constructor[]>(METADATA.PARAM_TYPES, reg.target, [])
const injectTokens = getClassMeta<Record<number, any>>(METADATA.INJECT, reg.target, {})
const autowired = getClassMap(METADATA.AUTOWIRED, target.prototype)


// ── router-builder.ts reads ──────────────────────────────────

// BEFORE:
const routes: RouteDefinition[] = Reflect.getMetadata(METADATA.ROUTES, controllerClass) || []
const classMiddleware = Reflect.getMetadata(METADATA.CLASS_MIDDLEWARES, controllerClass) || []
const methodMiddleware =
  Reflect.getMetadata(METADATA.METHOD_MIDDLEWARES, controllerClass, route.handlerName) || []

// AFTER:
const routes = getClassMeta<RouteDefinition[]>(METADATA.ROUTES, controllerClass, [])
const classMiddleware = getClassMeta<any[]>(METADATA.CLASS_MIDDLEWARES, controllerClass, [])
const methodMiddleware = getMethodMeta<any[]>(
  METADATA.METHOD_MIDDLEWARES, controllerClass, route.handlerName, []
)


// ── swagger reads ────────────────────────────────────────────

// BEFORE:
if (Reflect.getMetadata(SWAGGER_KEYS.EXCLUDE, controllerClass)) continue
const classTags: string[] = Reflect.getMetadata(SWAGGER_KEYS.TAGS, controllerClass) || []
const operation: ApiOperationOptions =
  Reflect.getMetadata(SWAGGER_KEYS.OPERATION, controllerClass, route.handlerName) || {}

// AFTER:
if (hasClassMeta(SWAGGER_KEYS.EXCLUDE, controllerClass)) continue
const classTags = getClassMeta<string[]>(SWAGGER_KEYS.TAGS, controllerClass, [])
const operation = getMethodMeta<ApiOperationOptions>(
  SWAGGER_KEYS.OPERATION, controllerClass, route.handlerName, {}
)
```

**Migration plan (mechanical, package by package):**

| Package | Files | Reflect calls | Priority |
|---------|-------|--------------|----------|
| `core` (decorators.ts) | 1 | 24 | First — most calls, defines patterns |
| `core` (container.ts) | 1 | 9 | Second — reads what decorators write |
| `core` (cron.ts) | 1 | 3 | With core |
| `http` (router-builder.ts) | 1 | 5 | Third — reads routes |
| `http` (application.ts) | 1 | 1 | With http |
| `swagger` (decorators.ts + builder.ts) | 2 | 20 | Fourth — biggest reader |
| `auth` (decorators.ts + adapter.ts) | 2 | 14 | Fifth |
| `graphql` (decorators.ts + adapter.ts) | 2 | 15 | Sixth |
| `ws` (decorators.ts + adapter.ts) | 2 | 7 | Seventh |
| `queue` (decorators.ts + adapter.ts) | 2 | 5 | Eighth |
| `devtools` (adapter.ts) | 1 | 3 | Last |
| `kickjs` (unified copies) | 3 | ~40 | Mirror core/http changes |

**Total: 186 calls → ~15 utility functions. Each call site becomes shorter and typed.**

**Why do this before Vite plugin work:**
- The Vite plugin's `module-discovery.ts` and `hmr-plugin.ts` will read metadata to detect
  which files contain `@Controller`, `@Service`, etc.
- With utilities, the plugin uses `hasClassMeta(METADATA.CLASS_KIND, target)` instead of raw Reflect
- If we later switch to Stage 3 decorators or a WeakMap store, we change ONE file (`metadata.ts`)

**Future benefit — swappable metadata backend:**
```typescript
// metadata.ts can later be changed to use WeakMap:
const metaStore = new WeakMap<object, Map<string | symbol, any>>()

export function setClassMeta<T>(key: symbol | string, value: T, target: Function): void {
  // WeakMap implementation instead of Reflect.defineMetadata
  let map = metaStore.get(target)
  if (!map) { map = new Map(); metaStore.set(target, map) }
  map.set(key, value)
}
```
All 186 call sites updated by changing ONE file. Zero changes in decorators/container/adapters.

**Verification:**
- `pnpm build` succeeds
- `pnpm test` passes (all 836+ tests)
- `pnpm format:check` passes
- No remaining raw `Reflect.defineMetadata` or `Reflect.getMetadata` in src/ (only in metadata.ts)

---

## What This Doesn't Cover (Future Work)

- **Typegen** (`kick typegen` for typed `container.resolve()`) — after plugin is stable
- **Build system migration** (tsdown + wireit) — independent parallel track
- **Server function RPC** (TanStack-style compile-time transforms) — not needed yet
- **Import protection** (prevent server code in client) — needed once Inertia ships

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| **httpServer not available in configureServer** | Verified: Vite source (`server/index.ts:317`) confirms `httpServer` is only null in `middlewareMode`. Without middleware mode, it's the real `http.Server`. |
| **WsAdapter upgrade handlers lost on HMR** | WsAdapter instance persisted on `globalThis.__kickjs_wsAdapter`. The `http.Server` never restarts (Vite owns it), so upgrade listeners persist. Only the Express request handler swaps. |
| **Socket.IO / other libs need httpServer at import time** | Libraries that call `new Server(httpServer)` in their constructor need the server available at adapter registration time. `afterStart({ server })` is called after `httpServer` is set — this is the right hook. |
| **Vite's own WebSocket conflicts with app WebSockets** | Vite's HMR WebSocket (`viteServer.ws`) runs on a separate internal channel. It does NOT conflict with app-level WebSocket upgrade handlers. Tested in React Router (which also uses `configureServer`). |
| **Express middleware ordering differs from Connect** | Express runs as a post-middleware callback from `configureServer()`. Vite's routes (HMR, assets) are matched first. Non-matching requests fall through to Express. Clean separation. |
| **ssrLoadModule() is slow for large apps** | Cache the bootstrap result; only re-evaluate when Vite invalidates the virtual module. First request is slow, subsequent requests reuse cache until file change. |
| **Decorator metadata lost on re-import** | Decorators fire on import — re-import = re-decorate. This is correct. The `allRegistrations` map already handles this. |
| **globalThis pollution** | Namespace: `__kickjs_httpServer`, `__kickjs_persistent`, `__kickjs_wsAdapter`, etc. |
| **User migration burden** | Minimal: `bootstrap()` returns app instead of auto-starting in dev. Add `if (process.env.NODE_ENV === 'production') app.start()`. Provide codemod. |
