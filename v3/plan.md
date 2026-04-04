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

## What This Doesn't Cover (Future Work)

- **Typegen** (`kick typegen` for typed `container.resolve()`) — after plugin is stable
- **Build system migration** (tsdown + wireit) — independent parallel track
- **Multi-router Vinxi-style** (separate client/devtools Vite instances) — future if needed
- **Server function RPC** (TanStack-style compile-time transforms) — not needed for backend framework
- **Import protection** (prevent server code in client) — not applicable (no client bundle)

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
