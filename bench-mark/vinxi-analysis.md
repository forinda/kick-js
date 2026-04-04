# Vinxi — Meta-Framework SDK Architecture Analysis

## Overview

Vinxi is the **meta-framework SDK** that powers SolidStart, TanStack Start, and others. Its core innovation is the **multi-router architecture**: each "router" is a separate build/compilation target (client, server, SPA, static) with its own Vite dev server instance, all coordinated by a single Nitro dev server. This is the most flexible architecture of all frameworks analyzed.

## Architecture Diagram

```
Dev Mode Architecture:

    Browser
      |
      +-- Vite HMR WebSocket (per-router, different ports)
      |
      +-- HTTP Request
            |
    Nitro Dev Server (H3 app, owns the port)
      |
      +-- Public Asset Middlewares (from static routers)
      |
      +-- Dev Handler Routing (longest base path first)
      |     |
      |     +-- /api/* --> HTTP Router Vite Dev Server
      |     |     +-- ssrLoadModule() for handler
      |     |     +-- Optional: Worker thread
      |     |
      |     +-- / --> Client Router Vite Dev Server
      |     |     +-- Static files, HMR, transforms
      |     |
      |     +-- /admin --> SPA Router Vite Dev Server
      |           +-- HTML transform, client bundle
      |
    Each Router = Separate Vite Instance:
      +-- Own HMR port (random)
      +-- Own plugin stack
      +-- Own module graph
      +-- Own dev handler

Build Mode:
    Per-Router Build (sequential, in worker threads)
      +-- Client Router --> browser bundle
      +-- HTTP Router --> server bundle
      +-- SPA Router --> SPA bundle
      +-- Static Router --> copied assets
            |
    Nitro Production Build
      +-- Aggregates all router outputs
      +-- Registers handlers per router
      +-- Deploys to target (node, cloudflare, etc.)
```

## Core Concepts

### Routers (Not URL Routing)

A "router" in Vinxi is a **build/compilation target**, not a URL router. Each has:

```typescript
{
  name: string
  base: string              // URL base (e.g., "/api", "/")
  type: string              // "client" | "http" | "spa" | "static" | "custom"
  handler: string           // Entry file path
  target: "server" | "browser" | "static"
  plugins?(): Plugin[]      // Router-specific Vite plugins
  internals: {
    type: RouterMode        // Reference to router mode definition
    devServer?: ViteDevServer
    appWorker?: AppWorkerClient
    routes?: CompiledRouter
  }
}
```

### 5 Router Types
**File:** `packages/vinxi/lib/router-modes.js`

1. **Static Router** (lines 143-170) — Serve static files (public assets)
2. **Client Router** (lines 171-238) — Browser bundle with Vite HMR
3. **HTTP Router** (lines 239-365) — Server-side handler, supports WebSocket hooks and worker threads
4. **SPA Router** (lines 367-502) — Single Page App with custom HTML handling
5. **Custom Router** — User-defined via `type.resolveConfig()`

## App Creation

**File:** `packages/vinxi/lib/app.js` (lines 45-200)

```javascript
createApp({
  routers: [
    { name: 'public', type: 'static', dir: './public' },
    { name: 'client', type: 'client', handler: './app/client.tsx', base: '/' },
    { name: 'ssr',    type: 'http',   handler: './app/server.tsx', base: '/' },
    { name: 'api',    type: 'http',   handler: './app/api.ts',    base: '/api' },
  ],
  server: { plugins: [...] }
})
```

**Key methods:**
- `addRouter(router)` — dynamically add routers
- `addRouterPlugins(filter, plugins)` — apply plugins to matching routers
- `stack(fn)` — composable configuration transformations
- `dev()` / `build()` — lifecycle entry points

Uses Hookable for events: `app:created`, `app:config-resolved`

## Dev Server Architecture

**File:** `packages/vinxi/lib/dev-server.js` (lines 103-259)

### Multi-Vite Instance Management

```javascript
async function createViteHandler(router, app, serveConfig) {
  // 1. Get random port for HMR
  const port = router.server?.hmr?.port ?? (await getRandomPort())
  
  // 2. Load router-specific dev plugins
  const plugins = [
    ...(await router.internals.type.dev.plugins?.(router, app)),
    ...(await router.plugins?.(router)),
  ]
  
  // 3. Create Vite dev server with middlewareMode: true
  const viteDevServer = await createViteDevServer({
    root: router.root,
    base: join(app.config.server.baseURL ?? "/", router.base),
    plugins,
    server: {
      middlewareMode: true,
      hmr: { ...router.server?.hmr, port },
    },
  })
  
  // 4. Store in router internals
  router.internals.devServer = viteDevServer
  return viteDevServer
}
```

**One Vite instance per router.** Each has its own HMR port, plugin stack, and module graph.

### Nitro Coordination

```javascript
const nitro = await createNitro({
  dev: true,
  preset: "nitro-dev",
  publicAssets: [/* from all static routers */],
  devHandlers: [/* from all routers' dev.handler() */],
})
```

Routers are sorted by base length (longest first) for proper URL matching.

### Custom Nitro Dev Server
**File:** `packages/vinxi/lib/nitro-dev.js` (lines 96-280)

- Uses H3 app directly (not Nitro's worker)
- Runs on main thread for dev convenience
- Registers public asset middlewares
- Sets up dev proxy handlers
- Implements error handling and WebSocket support
- Experimental async context support

## Plugin System

**File:** `packages/vinxi/lib/plugins/`

### Standard Plugin Stack per Router Type

**SPA Router:**
```javascript
[css(), routes(), devEntries(), manifest(), config("appType", {...}),
 treeShake(), fileSystemWatcher()]
```

**HTTP Router:**
```javascript
[virtual({[handlerModule]: ...}), routes(), devEntries(), manifest(),
 config("appType", {...}), treeShake(), config("handler:base", ...),
 fileSystemWatcher()]
```

### Core Plugins

1. **Manifest Plugin** (`manifest.js`) — Injects manifest into global scope, defines meta env vars
2. **Routes Plugin** (`routes.js`) — Virtual `vinxi/routes` module, code splitting with `?pick=`
3. **Virtual Plugin** (`virtual.js`) — `\0virtual:` prefixed modules, static or dynamic
4. **Tree-Shake Plugin** (`tree-shake.js`) — Babel-based extraction of named exports via `?pick=`
5. **CSS Plugin** (`css.js`) — Custom CSS HMR via WebSocket
6. **File System Watcher** (`fs-watcher.js`) — Route file change detection, dynamic updates

### Plugin Composition (app.js lines 135-149)

```javascript
addRouterPlugins(apply, plugins) {
  const routers = app.config.routers.filter(apply)
  routers.forEach((router) => {
    const prevPlugins = router.plugins
    router.plugins = () => [...plugins?.(), ...prevPlugins()]
  })
}
```

## HMR Strategy

### Client HMR
Standard Vite HMR via per-router WebSocket (random port via `get-port-please`).

### Server-Side HMR
1. **ssrLoadModule()** — HTTP router uses Vite's SSR module loading for fresh code per request
2. **CSS HMR** — Custom WebSocket events: `{ type: "custom", event: "css-update", data }`
3. **Route File HMR** — File watcher detects changes, triggers `router.internals.routes.update()`

### Worker Thread Support
**File:** `packages/vinxi/lib/app-worker-client.js` (lines 11-153)

For HTTP routers with `worker: true`:
- Creates Node.js Worker with `--conditions react-server`
- Request/response communication via message channel
- Worker signals reload via `{ type: "reload" }` message
- Unique request ID per request for multiplexing

## Build System

**File:** `packages/vinxi/lib/build.js` (lines 39-290)

**Build process:**
1. **Per-router build** — Sequential, each in worker thread
2. **Nitro production build** — Aggregates router outputs, registers handlers

**Handler registration (lines 155-196):**
- HTTP routers → built handler bundle via viteManifestPath
- SPA routers → `$vinxi/spa/{routerName}` virtual handler
- Static routers → publicAssets

**Virtual modules for production:**
- `$vinxi/prod-app` — App config with build manifests
- `$vinxi/chunks` — Server-side module chunks for dynamic imports

## Manifest System

**Dev Manifest** (`manifest/dev-server-manifest.js`):
- Lazy Proxy returning router manifests on access
- Uses Vite dev server for CSS and module loading

**Prod Manifest** (`manifest/prod-server-manifest.js`):
- Pre-built Vite manifests from bundle
- Chunks from `globalThis.$$chunks`

## File System Routing

**File:** `packages/vinxi/lib/fs-router.js` (lines 53-148)

Base class `BaseFileSystemRouter`:
- `buildRoutes()` — glob files, analyze AST via esbuild + es-module-lexer
- `toPath()` — abstract (framework-specific)
- `toRoute()` — file → route with component reference and `?pick=` exports
- File watching support via `update` callback

## Global State

```javascript
globalThis.app         // App instance
globalThis.MANIFEST    // Runtime manifest (dev or prod)
globalThis.viteServers // Map of router name → Vite dev server
globalThis.$$chunks    // Server-side module chunks
globalThis.$handle     // H3 app handler (from app-fetch plugin)
```

## Key Patterns for KickJS

| Pattern | Description | KickJS Application |
|---------|-------------|-------------------|
| **Multi-Router Architecture** | One Vite instance per build target | Separate client/server/devtools Vite instances |
| **Nitro as Coordinator** | Nitro routes requests to correct Vite instance | KickJS could use H3 or Express as coordinator |
| **Router Modes** | Typed router definitions with dev/build configs | Define KickJS router modes for API, SSR, devtools |
| **Composable Plugin Stacks** | Per-router plugins + global plugins | Module-specific Vite plugins |
| **`?pick=` Tree-Shaking** | Extract specific exports via query string | Module-level code splitting |
| **Worker Thread Support** | HTTP router can run in worker with message channel | Isolate heavy computation from main thread |
| **Global Manifest** | Runtime-accessible manifest (dev: lazy proxy, prod: pre-built) | Container registry as manifest |
| **Stack Pattern** | `app.stack(fn)` for composable config transforms | Plugin-style KickJS configuration |
| **File System Router Base Class** | Framework-agnostic route discovery | Module auto-discovery base class |
| **Dev Handler Sorting** | Longest base path first for URL matching | Correct route precedence in multi-module setup |

## Critical File References

| Component | Path | Key Lines |
|-----------|------|-----------|
| App creation | `packages/vinxi/lib/app.js` | 45-200 |
| Router modes | `packages/vinxi/lib/router-modes.js` | 143-502 (all types) |
| Dev server | `packages/vinxi/lib/dev-server.js` | 50-95 (createViteHandler), 103-259 (main) |
| Nitro dev | `packages/vinxi/lib/nitro-dev.js` | 96-280 |
| Build | `packages/vinxi/lib/build.js` | 39-290 |
| Manifest (dev) | `packages/vinxi/lib/manifest/dev-server-manifest.js` | Lazy proxy |
| Manifest (prod) | `packages/vinxi/lib/manifest/prod-server-manifest.js` | Pre-built |
| Worker | `packages/vinxi/lib/app-worker-client.js` | 11-153 |
| FS Router | `packages/vinxi/lib/fs-router.js` | 53-148 |
| Plugins | `packages/vinxi/lib/plugins/*.js` | manifest, routes, virtual, tree-shake, css, fs-watcher |
| CLI | `packages/vinxi/bin/cli.mjs` | Entry point |
| App loader | `packages/vinxi/lib/load-app.js` | 134-210 |
