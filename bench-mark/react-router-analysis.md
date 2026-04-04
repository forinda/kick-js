# React Router Vite Integration Analysis

## Overview

React Router (formerly Remix) has the most sophisticated Vite integration of all frameworks analyzed. Its 3900+ line Vite plugin handles SSR, code splitting, HMR, virtual modules, and dual client/server builds. The key pattern is: **Vite owns the dev server, Express is mounted as middleware, and `ssrLoadModule()` provides live server code on every request.**

## Architecture Diagram

```
Dev Mode Architecture:

    Browser
      |
      +-- Vite HMR WebSocket
      |
      +-- HTTP Request
            |
    Vite Dev Server (owns the port)
      |
      +-- Vite Static Middleware (JS, CSS, assets)
      |
      +-- Critical CSS Middleware (/@react-router/critical.css)
      |
      +-- SSR Request Middleware (React Router plugin)
            |
            +-- ssrLoadModule(virtual:server-build) [fresh every request]
            |     +-- Imports entry.server
            |     +-- Imports all route modules
            |     +-- Exports manifest, config, routes
            |
            +-- createRequestHandler(serverBuild)
            |     +-- fromNodeRequest() --> Fetch API Request
            |     +-- Match routes
            |     +-- Execute loaders/actions
            |     +-- SSR render
            |     +-- sendResponse() back to Node
            |
    Build Mode (Dual Build):
      +-- Client Build (browser bundle, code split by route)
      +-- SSR Build (server bundle, all routes)
      +-- Optional: multiple server bundles for edge/serverless
```

## Vite Plugin Architecture

**File:** `packages/react-router-dev/vite/plugin.ts` (3900+ lines)

The plugin returns an **array of sub-plugins** using these Vite hooks:

### Core Hooks

1. **`config()`** (line 1258) - Initial setup
   - Preloads Vite's ESM build
   - Sets `appType: "custom"` (not SPA/MPA)
   - Configures SSR externals, optimizeDeps
   - Sets up environment API (Vite 6+)

2. **`configResolved()`** (line 1494) - Post-config
   - Creates a **child Vite compiler** for route analysis (line 1533)
   - Independent plugin state, no HMR, no watching in build mode
   - Used for `getRouteModuleExports()` without affecting main build

3. **`configureServer()`** (line 1579) - Dev server middleware
   - Registers Critical CSS middleware at `/@react-router/critical.css`
   - Registers SSR request handler
   - Watches config changes, invalidates virtual modules

4. **`transform()`** - CSS modules tracking, route chunk transforms

5. **`handleHotUpdate()`** (line 2472) / `hotUpdate()` (line 2530)
   - Route file change detection
   - Virtual module invalidation
   - Custom HMR events: `server.hot.send({ event: "react-router:hmr", data })`
   - Cross-environment HMR for Vite 6+

6. **`resolveId()` / `load()`** - Virtual module resolution

### Virtual Modules

Three main virtual modules:

1. **`virtual:react-router/server-build`** - Full server entry with all routes imported
2. **`virtual:react-router/server-manifest`** - Route metadata and assets
3. **`virtual:react-router/browser-manifest`** - Client-side route manifest (injected as `window.__reactRouterManifest`)

Module ID pattern: `\0virtual:react-router/{name}`, Public URL: `/@id/__x00__virtual:react-router/{name}`

## Dev Server Flow

### SSR Request Handling (lines 1668-1709)

```typescript
// Every request gets fresh server code via ssrLoadModule
async function handleSSRRequest(req, res) {
  // Vite 7+: environment.runner.import()
  // Vite 6: ssrLoadModule()
  const serverBuild = await viteDevServer.ssrLoadModule(
    'virtual:react-router/server-build'
  )
  
  const handler = createRequestHandler(serverBuild)
  const request = fromNodeRequest(req, res)  // Node -> Fetch API
  const response = await handler(request)
  sendResponse(res, response)                 // Fetch API -> Node
}
```

**Key insight:** `ssrLoadModule()` returns the **latest compiled version** of the server build on every request. No restart, no manual invalidation needed.

### Critical CSS (styles.ts)

1. Match routes for pathname
2. Walk Vite module graph from matched routes + client entry
3. Extract CSS dependencies via SSR transform
4. Serve at `/@react-router/critical.css?pathname=`
5. Prevents FOUC

## HMR Strategy

### Server-Side HMR

React Router's server HMR is **implicit through `ssrLoadModule()`**:
- Vite's module graph tracks all server modules
- When a file changes, Vite invalidates affected modules
- Next `ssrLoadModule()` call returns fresh code
- No explicit server restart needed

### Client-Side HMR

1. **Virtual module invalidation** - when route files change, invalidate all virtual modules:
   ```typescript
   Object.values(virtual).forEach((vmod) => {
     let mod = viteDevServer.moduleGraph.getModuleById(vmod.resolvedId)
     if (mod) viteDevServer.moduleGraph.invalidateModule(mod)
   })
   ```

2. **Route metadata comparison** - compare old/new exports (hasLoader, hasAction, hasErrorBoundary, etc.)

3. **Custom HMR events** - `react-router:hmr` sent to client

4. **Cross-environment HMR** (Vite 6+) - `hotUpdate()` bridges SSR and client module graphs

### Child Compiler for Route Analysis (lines 1508-1572)

A separate Vite server for analyzing route exports without affecting the main build:
```typescript
viteChildCompiler = await vite.createServer({
  cacheDir: "node_modules/.vite-child-compiler",
  server: { preTransformRequests: false, hmr: false, watch: null },
  plugins: childCompilerPlugins.filter(p => 
    p.name !== "react-router" && 
    p.name !== "react-router:route-exports" &&
    p.name !== "react-router:hmr-updates"
  )
})
```

## Express Integration

**File:** `packages/react-router-express/server.ts`

```typescript
export function createRequestHandler({ build, getLoadContext, mode }): RequestHandler {
  let handleRequest = createRemixRequestHandler(build, mode)
  
  return async (req, res, next) => {
    let request = createRemixRequest(req, res)       // Express -> Fetch API
    let loadContext = await getLoadContext?.(req, res) // Inject context
    let response = await handleRequest(request, loadContext)
    await sendRemixResponse(res, response)            // Fetch API -> Express
  }
}
```

**Request conversion (`createRemixRequest`):**
- Extracts hostname, port, protocol, X-Forwarded-Host headers
- Creates AbortController for lifecycle
- Streams request body

**Response conversion (`sendRemixResponse`):**
- Sets status, statusMessage, headers
- Handles text/event-stream for SSE
- Streams response body via `writeReadableStreamToWritable()`

**`getLoadContext` pattern:** Optional callback `(req, res) => AppLoadContext` to inject server context into loaders/actions.

## Build System

**File:** `packages/react-router-dev/vite/build.ts`

### Dual Build Strategy

- **Vite 6+ (Environment API):** Parallel builds via `builder.buildApp()` with `client` and `ssr` environments
- **Vite 5 (Legacy):** Sequential: client first, then SSR

### Route Code Splitting
**File:** `packages/react-router-dev/vite/route-chunks.ts`

Splits large route modules into chunks:
- `?route-chunk=clientAction`
- `?route-chunk=clientLoader`
- `?route-chunk=clientMiddleware`
- `?route-chunk=HydrateFallback`

### Server-Only Export Removal
**File:** `packages/react-router-dev/vite/remove-exports.ts`

```typescript
SERVER_ONLY_EXPORTS = ["loader", "action", "middleware", "headers"]
CLIENT_ROUTE_EXPORTS = ["clientAction", "clientLoader", "clientMiddleware",
  "handle", "meta", "links", "shouldRevalidate", "default", "ErrorBoundary",
  "HydrateFallback", "Layout"]
```

### Manifest Generation (lines 958-1227)

Two types:
- **Build manifest:** Generated once from Vite manifest + route exports
- **Dev manifest:** Generated dynamically from child compiler analysis
- Written to client build dir and inlined as `window.__reactRouterManifest`

## Key Patterns for KickJS

| Pattern | Description | KickJS Application |
|---------|-------------|-------------------|
| **Vite Owns the Port** | Express is middleware ON Vite, not the other way | Proven pattern for single-port dev server |
| **ssrLoadModule()** | Fresh server code every request, no restart | Replace reactive proxy with this for simplicity |
| **Child Compiler** | Separate Vite instance for analysis (no HMR) | Use for decorator scanning, module discovery |
| **Virtual Modules** | Contract between Vite and framework | Auto-generated container registry, module discovery |
| **Fetch API Bridge** | Express req/res <-> Fetch API conversion | Platform-agnostic handlers |
| **getLoadContext** | Callback to inject Express state into handlers | Bridge Express middleware to DI context |
| **Route Chunk Splitting** | Query-string-based code splitting | Could apply to module-level splitting |
| **Server Export Removal** | Tree-shake server code from client bundle | Useful if KickJS ever has client-side |

## Critical File References

| Component | Path | Key Lines |
|-----------|------|-----------|
| Main Plugin | `react-router-dev/vite/plugin.ts` | 694 (entry), 1258 (config), 1579 (configureServer) |
| Dev Server | `react-router-dev/vite/plugin.ts` | 1668-1709 (SSR middleware) |
| HMR | `react-router-dev/vite/plugin.ts` | 2472 (handleHotUpdate), 2530 (hotUpdate) |
| Virtual Modules | `react-router-dev/vite/virtual-module.ts` | Module ID patterns |
| Express Handler | `react-router-express/server.ts` | 44-73 (createRequestHandler) |
| Build | `react-router-dev/vite/build.ts` | 33-237 (dual build) |
| Route Chunks | `react-router-dev/vite/route-chunks.ts` | 938-943 (chunk types) |
| Export Removal | `react-router-dev/vite/remove-exports.ts` | 131-147 (export lists) |
| Styles | `react-router-dev/vite/styles.ts` | CSS collection |
| Node Runtime | `react-router-node/server.ts` | Request listener |
| Serve CLI | `react-router-serve/cli.ts` | 71-160 (production server) |
| Child Compiler | `react-router-dev/vite/plugin.ts` | 1508-1572 (setup) |
