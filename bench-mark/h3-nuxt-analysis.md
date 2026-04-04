# H3 + Nuxt Vite Integration Analysis

## Overview

H3 is a minimal, high-performance HTTP framework with a Fetch API-native design. Nuxt uses H3 (via Nitro) as its server layer and integrates Vite through a sophisticated plugin system with IPC-based module loading and invalidation-based HMR — **no server restart needed**.

## Architecture Diagram

```
Nuxt Dev Mode Architecture:

    Browser
      |
      +-- Vite HMR WebSocket (port 24678+)
      |
      +-- HTTP Request
            |
    Nitro Dev Server (H3 App)
      |
      +-- Vite Dev Middleware (DevServerPlugin)
      |     +-- Static assets, @vite/client, HMR
      |     +-- Selective: _skip_transform for non-Vite paths
      |
      +-- H3 Router
      |     +-- Global middleware --> Route middleware --> Handler
      |     +-- callMiddleware() recursive chain
      |
      +-- SSR via Vite-Node IPC
            +-- Socket: [4-byte length][UTF-8 JSON]
            +-- Messages: manifest, invalidates, resolve, module
            +-- Nitro fetches compiled modules from Vite SSR env
            +-- Invalidation tracking via file watcher

HMR Flow (No Restart):
  File Change
    --> Vite watcher detects
    --> Module added to invalidates Set
    --> Importers marked invalid (upstream walk)
    --> Next request fetches fresh module via IPC
    --> Dynamic handler swap (no process restart)
```

## H3 Core Architecture

### Dual-Class Pattern
**File:** `/home/forinda/dev/open-source/h3/src/h3.ts`

- **H3Core** (base): Request/response handler with plugin lifecycle hooks
- **H3** (extends H3Core): Full router with `rou3` integration

```
ServerRequest --> H3Core.fetch() --> "~request" --> handler() --> toResponse()
```

### Event System
**File:** `/home/forinda/dev/open-source/h3/src/event.ts`

`H3Event` wraps ServerRequest with:
- **Context isolation** — mutable `context` object for params, middleware data
- **Lazy-loaded response** — via symbol-keyed property (avoids collisions)
- **Percent-encoded pathname normalization** — prevents middleware bypass attacks
- **Runtime context** — node, deno, etc. specific

```typescript
// Symbol-keyed storage avoids property collisions
const kEventRes = Symbol('kEventRes')
const kEventResHeaders = Symbol('kEventResHeaders')
```

### Handler Composition
**File:** `/home/forinda/dev/open-source/h3/src/handler.ts`

Key handler types:
- **defineHandler()** — wraps handlers with `.fetch()` method
- **dynamicEventHandler()** — **mutable handler with `.set()` for hot-swapping** (critical for HMR)
- **defineLazyEventHandler()** — lazy-loaded with promise caching

```typescript
// The key to H3's HMR story:
dynamicEventHandler(initialHandler) {
  let current = initialHandler
  const handler = (event) => current(event)
  handler.set = (newHandler) => { current = newHandler }
  return handler
}
```

### Middleware Chain
**File:** `/home/forinda/dev/open-source/h3/src/middleware.ts`

Recursive next() pattern:
```typescript
callMiddleware(event, middleware[], handler, index=0):
  if (index === middleware.length) -> return handler(event)
  fn = middleware[index]
  next = () -> callMiddleware(event, middleware, handler, index+1)
  return fn(event, next)
```

- Middleware signature: `(event, next) => any | Promise<any>`
- If middleware returns `undefined` or `kNotFound` → calls `next()`
- Global middleware runs first, then route-specific

### Sub-Application Mounting
**File:** `/home/forinda/dev/open-source/h3/src/h3.ts` lines 122-153

```typescript
mount(base, input) {
  if ("handler" in input) {
    // Mount H3 sub-app: wrap middleware with pathname mutation/restoration
    input["~middleware"].forEach(mw => {
      this["~middleware"].push((event, next) => {
        if (event.url.pathname.startsWith(base)) {
          event.url.pathname = event.url.pathname.slice(base.length) || "/"
          return callMiddleware(event, input["~middleware"], () => {
            event.url.pathname = originalPathname
            return next()
          })
        }
        return next()
      })
    })
    // Merge routes with base prefix
    input["~routes"].forEach(r => {
      this["~addRoute"]({ ...r, route: base + r.route })
    })
  }
}
```

## Nuxt's Vite Integration

### Plugin Stack
**File:** `/home/forinda/dev/open-source/nuxt/packages/vite/src/vite.ts`

Dual-environment Vite config:
```typescript
config.environments = {
  client: { consumer: 'client', dev: { warmup: [entry] }, ...clientEnvironment() },
  ssr: { consumer: 'server', dev: { warmup: [serverEntry] }, ...ssrEnvironment() }
}
```

Plugin stack includes:
- PerfPlugin, ResolveDeepImportsPlugin, ResolveExternalsPlugin
- VuePlugin, ViteNodePlugin (IPC), ClientManifestPlugin
- **DevServerPlugin** (H3 middleware gateway)
- DevStyleSSRPlugin, TypeCheckPlugin, SourcemapPreserverPlugin

### Dev Server Plugin — The Gateway
**File:** `/home/forinda/dev/open-source/nuxt/packages/vite/src/plugins/dev-server.ts`

Creates an H3 event handler that bridges Vite and Nitro:

1. **Template invalidation** — watches for template changes, invalidates Vite modules:
   ```typescript
   nuxt.hook('app:templatesGenerated', async (_app, changedTemplates) => {
     changedTemplates.forEach(template => {
       const mods = viteServer.moduleGraph.getModulesByFile(`virtual:nuxt:${template.dst}`)
       mods.forEach(mod => {
         viteServer.moduleGraph.invalidateModule(mod)
         viteServer.reloadModule(mod)
       })
     })
   })
   ```

2. **Selective routing** — checks if request is Vite-handled:
   - Base path matching
   - Known Vite routes
   - Proxy detection
   - Sets `req._skip_transform` for non-Vite paths

3. **Skip-transform rewriting** — inserts middleware BEFORE Vite's transform to rewrite `_skip_transform` requests to `/__skip_vite` path

### Vite-Node IPC Protocol
**File:** `/home/forinda/dev/open-source/nuxt/packages/vite/src/vite-node.ts`

Binary protocol for server-side module fetching:
- Format: `[4-byte BE length][UTF-8 JSON message]`
- Request types:
  - `'manifest'` — returns normalized Vite manifest
  - `'invalidates'` — returns list of invalidated files
  - `'resolve'` — resolves module ID via SSR plugin container
  - `'module'` — fetches compiled module via `ssrServer.fetchModule()`

**Buffer management:**
- Pre-allocated 64KB buffer with exponential growth (max 1GB)
- Compacting strategy when read offset > 50% capacity

**Retry logic:**
- Exponential backoff with 10% jitter
- 5 max attempts, 100ms base delay, 2000ms cap
- 60s request timeout
- Automatic socket reconnection

### Invalidation-Based HMR (No Restart!)

**File watcher integration:**
```typescript
clientServer.watcher.on('all', (_event, file) => {
  invalidates.add(file)
  markInvalidates(clientServer.moduleGraph.getModulesByFile(normalize(file)))
})
```

**Invalidation tracking:**
```typescript
function markInvalidate(mod) {
  invalidates.add(mod.id)
  markInvalidates(mod.importers) // Walk upstream dependents
}
```

**Dynamic handler swapping (Nitro):**
```typescript
const dynamicHandler = dynamicEventHandler(initialHandler)
nitro.hooks.hook('build:error', (err) => {
  dynamicHandler.set(errorHandler) // Swap on error, no restart
})
```

## Key Patterns for KickJS

### 1. Dynamic Event Handler (Hot-Swappable)
H3's `dynamicEventHandler()` with `.set()` is the key to server-side HMR without restart. **KickJS should implement this pattern** — wrap the main request handler in a mutable container that can be swapped atomically.

### 2. IPC-Based Module Loading
Nuxt's vite-node uses a binary IPC socket to fetch compiled modules. This separates the Vite compilation server from the runtime server. **KickJS could use this pattern** to keep Vite as a compilation service while Express handles HTTP.

### 3. Invalidation Graph Walking
When a file changes, Nuxt marks it AND all its importers as invalid. Next request fetches fresh versions. **This is the reactive model KickJS wants** — instead of restarting, invalidate the dependency graph and re-resolve on next access.

### 4. Selective Middleware Routing
DevServerPlugin acts as a gateway — routing Vite assets to Vite and API routes to Nitro/H3. The `_skip_transform` pattern avoids Vite processing non-Vite requests. **KickJS needs this pattern** for the single-port dev server.

### 5. Symbol-Keyed Storage
H3 uses unique symbols for internal properties to avoid collisions. **Good practice for KickJS's reactive proxy layer.**

### 6. Sub-App Mounting with Pathname Mutation
H3's mount() mutates `event.url.pathname` for sub-apps and restores it after. **This is how KickJS can mount Express on Vite or vice versa.**

## Critical File References

| Component | Path | Key Lines |
|-----------|------|-----------|
| H3 App | `h3/src/h3.ts` | 31-96 (H3Core), 98-219 (H3) |
| Event | `h3/src/event.ts` | 28-144 (H3Event) |
| Handlers | `h3/src/handler.ts` | 128-140 (dynamicEventHandler) |
| Middleware | `h3/src/middleware.ts` | 60-91 (callMiddleware) |
| Response | `h3/src/response.ts` | 11-31 (toResponse) |
| Nuxt Vite | `nuxt/packages/vite/src/vite.ts` | 181-220 (plugins), 269-274 (dev server) |
| Dev Server Plugin | `nuxt/packages/vite/src/plugins/dev-server.ts` | 59-213 (configureServer) |
| Vite-Node IPC | `nuxt/packages/vite/src/vite-node.ts` | 278-463 (socket server) |
| Nitro Server | `nuxt/packages/nitro-server/src/index.ts` | 994-1001 (dev server) |
