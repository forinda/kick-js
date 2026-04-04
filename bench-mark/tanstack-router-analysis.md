# TanStack Router / TanStack Start — Architecture Analysis

## Overview

TanStack Start is a full-stack meta-framework built on TanStack Router, using Vite's new **Environment API** for dual client/server builds. It features a sophisticated **server function RPC system** (compile-time transformation), **file-based routing with code generation**, and optional **Nitro V2 integration** for deployment targets. The Vite plugin is a composition of ~10 sub-plugins.

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
      +-- Pre-middleware: CSS endpoint (/@tanstack-start/styles.css)
      |
      +-- Vite Static Middleware
      |
      +-- Post-middleware: Dev base rewrite
      |
      +-- SSR Handler (dev-server-plugin)
            |
            +-- Load #tanstack-router-entry (virtual)
            +-- Load #tanstack-start-entry (virtual)
            |
            +-- Request classification:
            |     +-- Server function? (/__tsr/) --> handleServerAction()
            |     +-- Has request middleware? --> execute chain
            |     +-- Route match? --> route-specific middleware + SSR
            |
            +-- SSR render with manifest + asset URLs
            |
    Build Mode (Dual Environment):
      +-- Client build (browser)
      +-- SSR build (server)
      +-- Optional: Nitro V2 for deployment packaging

Server Function Compilation:
  Source:  createServerFn().handler(async (ctx) => { ... })
  Client:  createClientRpc(functionId)  // HTTP fetch stub
  SSR:     createSsrRpc(functionId, () => import('./fn').then(m => m.name))
  Server:  createServerRpc(serverFnMeta, fn)  // Direct call
```

## Vite Plugin Architecture

**File:** `packages/start-plugin-core/src/plugin.ts` (472 lines)

Returns an array of composed sub-plugins:

1. **`tanstack-start-core:config`** - Main config (lines 111-437)
   - Normalizes Vite base path and router basepath alignment
   - Dual-environment build: `{ server: 'ssr', client: 'client' }`
   - Resolves entry points (start, router, client, server)
   - Uses `builder.sharedPlugins: true` (line 336)
   - Dev-base rewrite middleware for misaligned routing

2. **`startCompilerPlugin()`** - Server function transformation
3. **`importProtectionPlugin()`** - Prevents client importing server code
4. **`tanStackStartRouter()`** - File-based route generation
5. **`loadEnvPlugin()`** - Environment variable loading
6. **`startManifestPlugin()`** - Asset manifest generation
7. **`devServerPlugin()`** - Dev server SSR setup
8. **`previewServerPlugin()`** - Preview mode handling

## Server Runtime

**File:** `packages/start-server-core/src/createStartHandler.ts` (905 lines)

### Request Flow

1. **Request normalization** (lines 539-548): Protocol-relative URLs, pathname normalization
2. **Entry loading** (lines 550, 224-230): Lazy-loads virtual modules:
   - `#tanstack-router-entry` - User's router definition
   - `#tanstack-start-entry` - Optional start instance
3. **Server function routing** (lines 608-646):
   - Detects `TSS_SERVER_FN_BASE` prefix (e.g., `/__tsr/serverFnId`)
   - Routes to `handleServerAction()` 
4. **Request middleware execution** (lines 701-743):
   - Flattens middleware to prevent duplication
   - Executes chain with context merging
5. **Route handling** (lines 813-904):
   - Exact route matching for server handlers
   - Route-specific middleware collection
   - Router SSR execution
6. **SSR rendering** (lines 649-699):
   - Manifest with transformed asset URLs
   - Router SSR utilities attachment
   - Cleanup in finally block

## Server Function RPC System

### Compilation Pipeline

**File:** `packages/start-plugin-core/src/start-compiler-plugin/`

**Detection patterns (`compiler.ts` lines 88-113):**
```typescript
KindDetectionPatterns = {
  ServerFn:       /\bcreateServerFn\b|\.\s*handler\s*\(/,
  Middleware:      /createMiddleware/,
  IsomorphicFn:   /createIsomorphicFn/,
  ServerOnlyFn:   /createServerOnlyFn/,
  ClientOnlyFn:   /createClientOnlyFn/,
  ClientOnlyJSX:  /<ClientOnly|import\s*\{[^}]*\bClientOnly\b/,
}
```

### Three RPC Modes

**File:** `packages/start-plugin-core/src/start-compiler-plugin/handleCreateServerFn.ts`

1. **Provider RPC** (`createServerRpc.ts`): Direct function call with metadata (server environment)
2. **Client RPC** (`createClientRpc`): HTTP fetch stub → `/__tsr/functionId`
3. **SSR RPC** (`createSsrRpc.ts`): Direct import in SSR, or manifest lookup

**Babel templates generate environment-specific code:**
```typescript
// Source
const getUser = createServerFn().handler(async (ctx) => { ... })

// Client output (replaced at compile time)
const getUser = createClientRpc('getUser_abc123')

// SSR output  
const getUser = createSsrRpc('getUser_abc123', () => import('./fn').then(m => m['getUser']))

// Server output
const getUser = createServerRpc({ functionId: 'getUser_abc123' }, async (ctx) => { ... })
```

### Server Function Handler
**File:** `packages/start-server-core/src/server-functions-handler.ts`

- Validates HTTP method matches function definition
- Handles multiple payload types: FormData, JSON (Seroval serialization), query string
- Frame-protocol for streaming responses (`TSS_CONTENT_TYPE_FRAMED_VERSIONED`)
- Lazy-initialized Seroval plugins

## File-Based Routing

**File:** `packages/router-generator/src/generator.ts`

**Generator features:**
- Shadow cache pattern for incremental updates
- Token regex pre-compilation for filename/segment matching
- File event queue for watch mode
- Supports `.ts`, `.tsx`, `.js`, `.jsx`, `.cjs`, `.mjs`

**Start Router Plugin (`start-router-plugin/plugin.ts`):**
- Uses `@tanstack/router-plugin/vite` exports
- Prunes server-only subtrees before client build
- Generates module declarations for type safety
- Invalidates on route file changes

## Import Protection

**File:** `packages/start-plugin-core/src/import-protection-plugin/plugin.ts`

Prevents client code from importing server-only modules:
- Compiled regex matchers cached per source import
- Two mock modes:
  - **Dev:** Self-denial module with detailed error reporting
  - **Prod:** Silent self-contained mock module
- Builds import trace through module graph for diagnostics

## Dev Server Plugin

**File:** `packages/start-plugin-core/src/dev-server-plugin/plugin.ts`

### CSS Style Collection
- Middleware at `/@tanstack-start/styles.css`
- Module graph traversal from entry points
- Captures raw CSS content during Vite's transform hook (before JS wrapping)
- Filters out `?url`, `?inline`, `?raw` imports

**CSS Module Caching (`dev-styles.ts` lines 26-43):**
```typescript
// Capture CSS before Vite wraps it in JS
transform(code, id) {
  if (isCSS(id)) {
    cssModulesCache.set(normalizeId(id), extractCssContent(code))
  }
}
```

### Head Script Injection
- Extracts Vite-injected head scripts via `transformIndexHtml()`
- Caches for injection on every SSR request

## Nitro V2 Integration

**File:** `packages/nitro-v2-vite-plugin/src/index.ts` (198 lines)

**Integration flow (lines 19-141):**
1. Captures SSR bundle via `generateBundle` hook
2. Builds client environment first, then SSR
3. Creates Nitro instance with captured SSR bundle as virtual module
4. Virtual bundle plugin resolves chunk imports

**Virtual module entry:**
```typescript
import { fromWebHandler } from 'h3'
export default fromWebHandler(handler)
```

## Manifest System

**File:** `packages/start-plugin-core/src/start-manifest-plugin/`

- Virtual module: `tanstack-start-manifest:v`
- **Dev:** Empty routes with dynamic client entry URL
- **Build:** Complete manifest from client bundle + route tree

**Asset URL transformation (`transformAssetUrls.ts`):**
- String prefix: CDN URL prepend
- Object with callback: Per-request transformation
- Cached callback: Transform once, reuse

**Manifest caching:**
```typescript
// Dev: always fresh
if (process.env.TSS_DEV_SERVER === 'true') return loadFreshManifest()
// Prod: cache after first request
if (cached) return cached
cached = await loadManifest()
return cached
```

## HMR Strategy

TanStack Start relies on **Vite's default HMR** — no custom HMR hooks found:
- Module graph traversal in dev styles naturally supports reloading
- `ssrLoadModule()` equivalent via environment runner handles server code freshness
- Route file changes trigger route generator re-run + virtual module invalidation

**Dev environment variables:**
- `TSS_DEV_SERVER = 'true'` — enables dev features
- `TSS_DEV_SSR_STYLES_ENABLED` — route-specific CSS collection
- `TSS_DEV_SSR_STYLES_BASEPATH` — asset URL alignment

## Key Patterns for KickJS

| Pattern | Description | KickJS Application |
|---------|-------------|-------------------|
| **Composed Plugin Array** | 10 sub-plugins with single concerns | KickJS Vite plugin as composable array |
| **Server Function RPC** | Compile-time code transformation per environment | Decorator-based server functions with env-aware output |
| **Import Protection** | Prevent client from importing server modules | DI container code should never leak to client |
| **Shadow Cache** | Generator caches with shadow + swap pattern | Incremental module discovery |
| **Virtual Module Contract** | Entry, manifest, server-fn-resolver as virtuals | Container registry, module discovery as virtuals |
| **Nitro Deployment** | Package SSR bundle as Nitro virtual module | Multiple deployment targets from same codebase |
| **CSS Module Caching** | Capture CSS during transform before JS wrapping | Dev-mode CSS injection for KickJS devtools |
| **Framed Streaming** | Streaming RPC responses with frame protocol | Real-time server function responses |

## Critical File References

| Component | Path | Key Functions |
|-----------|------|--------------|
| Vite Plugin | `start-plugin-core/src/plugin.ts` | `TanStackStartVitePluginCore()` |
| Compiler | `start-compiler-plugin/compiler.ts` | `StartCompiler`, `detectKindsInCode()` |
| Server Handler | `start-server-core/src/createStartHandler.ts` | `createStartHandler()` |
| Server Functions | `start-server-core/src/server-functions-handler.ts` | `handleServerAction()` |
| Manifest | `start-manifest-plugin/manifestBuilder.ts` | `buildStartManifest()` |
| Dev Styles | `dev-server-plugin/dev-styles.ts` | `collectDevStyles()` |
| Router Gen | `router-generator/src/generator.ts` | `Generator` class |
| RPC (SSR) | `start-server-core/src/createSsrRpc.ts` | `createSsrRpc()` |
| RPC (Server) | `start-server-core/src/createServerRpc.ts` | `createServerRpc()` |
| Import Protection | `import-protection-plugin/plugin.ts` | `importProtectionPlugin()` |
| Nitro V2 | `nitro-v2-vite-plugin/src/index.ts` | `nitroV2Plugin()` |
| Start Router | `start-router-plugin/plugin.ts` | `tanStackStartRouter()` |
