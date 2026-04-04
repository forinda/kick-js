# AdonisJS + Vite Plugin Analysis

## Overview

AdonisJS uses a **provider-based IoC container** (`@adonisjs/fold`) with a three-phase lifecycle (register/boot/ready). Its Vite integration runs Vite in `middlewareMode` alongside the AdonisJS HTTP server, with the Vite dev server proxied through standard AdonisJS middleware. The approach is simpler than Nuxt/React Router — AdonisJS owns the HTTP port and Vite is a middleware layer.

## Architecture Diagram

```
Dev Mode Architecture:

    Browser
      |
      +-- Vite HMR WebSocket (separate port via VITE_HMR_PORT)
      |
      +-- HTTP Request
            |
    AdonisJS HTTP Server (owns the port)
      |
      +-- AdonisJS Middleware Pipeline
      |     +-- ... other middleware ...
      |     +-- ViteMiddleware (proxies to Vite)
      |     |     +-- If Vite handles it (assets, HMR) --> respond
      |     |     +-- If not --> call next()
      |     +-- ... more middleware ...
      |     +-- Route Handler
      |
    Vite Dev Server (middlewareMode: true, appType: 'custom')
      +-- No own HTTP port
      +-- Module graph for CSS collection
      +-- HMR via separate WebSocket port

Provider Lifecycle:
  register() --> Bind singletons to container
  boot()     --> Cross-provider setup, Edge plugin registration
  ready()    --> Start Vite dev server (if dev mode)
  shutdown() --> Stop Vite dev server

Ignitor Startup:
  createApp('web') --> app.init() --> app.boot() --> app.start()
    +-- resolve('server')
    +-- server.boot()
    +-- createHTTPServer(server.handle)
    +-- listen()
```

## IoC Container

**File:** `adonis-js/modules/container.ts` (re-exports from `@adonisjs/fold`)

Container operations:
- `container.singleton(key, resolver)` — singleton bindings with async resolver
- `container.bindValue(key, value)` — direct value bindings
- `container.alias(alias, key)` — create aliases
- `container.make(key)` — async resolution

```typescript
// From app_provider.ts lines 98-101
protected registerApp() {
  this.app.container.singleton(Application, () => this.app)
  this.app.container.alias('app', Application)
}
```

## Provider System — Three-Phase Lifecycle

**Files:** `adonis-js/providers/app_provider.ts` (401 lines), `adonisjs-vite-plugin/providers/vite_provider.ts` (182 lines)

### Phase 1: register()
Bind container singletons. No async. No cross-provider access.

```typescript
// app_provider.ts lines 353-366
register() {
  this.registerApp()        // Application singleton
  this.registerLogger()     // Logger singleton
  this.registerConfig()     // Config singleton
  this.registerEmitter()    // Event emitter
  this.registerEncryption() // Encryption service
  this.registerServer()     // HTTP Server (depends on encryption, emitter, logger)
  this.registerRouter()     // Router (from server)
  // ... more services
}
```

### Phase 2: boot()
Cross-provider integration. Can access other registered services.

```typescript
// vite_provider.ts lines 140-143
boot() {
  // Register Edge template tags (@vite, @viteReactRefresh)
  // Register Shield CSP keywords
}
```

### Phase 3: ready()
Final setup after everything is running.

```typescript
// vite_provider.ts lines 155-162
async ready() {
  if (!this.#shouldRunViteDevServer) return
  const vite = await this.app.container.make('vite')
  await vite.createDevServer()
}
```

### Shutdown
```typescript
// vite_provider.ts lines 173-180
async shutdown() {
  if (!this.#shouldRunViteDevServer) return
  const vite = await this.app.container.make('vite')
  await vite.stopDevServer()
}
```

## HTTP Server Setup

**File:** `adonis-js/src/ignitor/http.ts` (204 lines)

**Server registration with async DI resolution (app_provider.ts lines 216-244):**
```typescript
protected registerServer() {
  this.app.container.singleton(Server, async (resolver) => {
    const encryption = await resolver.make(Encryption)
    const emitter = await resolver.make('emitter')
    const logger = await resolver.make('logger')
    const config = this.app.config.get<any>('app.http')
    return new Server(this.app, encryption, emitter, logger, config)
  })
}

protected registerRouter() {
  this.app.container.singleton(Router, async (resolver) => {
    const server = await resolver.make('server')
    return server.getRouter()
  })
}
```

## Vite Plugin Integration

### Vite Class
**File:** `adonisjs-vite-plugin/src/vite.ts` (594 lines)

| Method | Purpose | Lines |
|--------|---------|-------|
| `createDevServer()` | Initialize Vite in middleware mode | 492-508 |
| `createModuleRunner()` | SSR module runner | 524-527 |
| `generateEntryPointsTags()` | Script/link tags (dev or prod) | 404-415 |
| `assetPath()` | Versioned asset URL | 441-448 |
| `manifest()` | Read manifest file (prod only) | 462-476 |
| `getReactHmrScript()` | React refresh script | 571-592 |
| `stopDevServer()` | Graceful close | 537-539 |

**Dev server creation (lines 492-508):**
```typescript
async createDevServer(options?: InlineConfig) {
  const { createServer } = await import('vite')
  const hmrPort = Number(process.env.VITE_HMR_PORT)
  
  this.#devServer = await createServer({
    server: {
      middlewareMode: true,
      ...(hmrPort && !Number.isNaN(hmrPort) ? { hmr: { port: hmrPort } } : {}),
    },
    appType: 'custom',
    ...options,
  })
}
```

**Dev mode CSS collection (lines 223-279):**
```typescript
async #generateEntryPointsTagsForDevMode(entryPoints, attributes) {
  const server = this.getDevServer()!
  
  // Warmup request to populate module graph
  if (server?.moduleGraph.idToModuleMap.size === 0) {
    await Promise.allSettled(
      jsEntrypoints.map(ep => server.warmupRequest(`/${ep}`))
    )
  }
  
  // Collect CSS from module graph
  // Generate HMR client script
  return [...cssTagsElement, viteHmr].concat(tags)
}
```

### Vite Middleware — The Bridge
**File:** `adonisjs-vite-plugin/src/vite_middleware.ts` (96 lines)

```typescript
async handle({ request, response }: HttpContext, next: NextFn) {
  if (!this.#devServer) return next()

  return new Promise<void>((resolve, reject) => {
    function done(error?: any) {
      response.response.removeListener('finish', done)
      if (error) reject(error)
      else resolve()
    }

    response.response.addListener('finish', done)
    response.relayHeaders()

    // Proxy to Vite's connect middleware
    this.#devServer.middlewares.handle(request.request, response.response, async () => {
      // Vite didn't handle it -> call next AdonisJS middleware
      response.response.removeListener('finish', done)
      try {
        await next()
        done()
      } catch (error) {
        done(error)
      }
    })
  })
}
```

### Client-Side Vite Plugin
**File:** `adonisjs-vite-plugin/src/client/main.ts` (36 lines)

```typescript
export default function adonisjs(options: PluginOptions): PluginOption[] {
  const fullOptions = Object.assign({
    assetsUrl: '/assets',
    buildDirectory: 'public/assets',
    reload: ['./resources/views/**/*.edge'],  // Full page reload on template change
  }, options)
  return [PluginRestart({ reload: fullOptions.reload }), config(fullOptions)]
}
```

### Edge.js Template Integration
**File:** `adonisjs-vite-plugin/src/plugins/edge.ts` (137 lines)

Custom template tags:
- `@vite('app.js')` — generates entry point script/link tags (dev: Vite client + entrypoint, prod: manifest-based)
- `@viteReactRefresh` — React refresh HMR script

### Build Hook
**File:** `adonisjs-vite-plugin/src/hooks/build_hook.ts`

```typescript
export default hooks.buildStarting(async (parent) => {
  parent.ui.logger.info('building assets with vite')
  const builder = await createBuilder({}, null)
  await builder.buildApp()
})
```

## Config Provider Pattern

**File:** `adonis-js/src/config_provider.ts` (76 lines)

Defers config resolution until app is booted:
```typescript
export const configProvider = {
  create<T>(resolver): ConfigProvider<T> {
    return { type: 'provider', resolver }
  },
  async resolve<T>(app, provider): Promise<T | null> {
    if (provider?.type === 'provider') return provider.resolver(app)
    return null
  },
}
```

## HMR / Dev Reload Strategy

AdonisJS does **NOT** have server-side HMR. Vite integration is for **frontend assets only**:
- Vite handles JS/CSS HMR for the browser
- Backend code changes require **process restart** (file watcher like `nodemon`)
- The `reload` option triggers **full page reload** for template changes

**Environment detection:**
```typescript
this.#shouldRunViteDevServer = appEnvironment === 'test' || !!process.env.DEV_MODE
```

## Key Patterns for KickJS

| Pattern | Description | KickJS Application |
|---------|-------------|-------------------|
| **Three-Phase Lifecycle** | register/boot/ready separation | Clear ordering for DI, cross-provider setup, runtime init |
| **Middleware Mode Vite** | `middlewareMode: true, appType: 'custom'` | KickJS owns HTTP, Vite is middleware (simpler than React Router) |
| **Promise-Based Middleware Bridge** | Wraps Vite connect middleware in framework middleware | Pattern for bridging Express middleware with KickJS pipeline |
| **Config Providers** | Deferred resolution until boot | Runtime env var substitution |
| **Module Graph CSS** | Walk Vite module graph for CSS deps | Dev-mode CSS injection |
| **Assembly Hooks** | `buildStarting` hook integrates Vite build | KickJS can hook build phases |
| **Environment-Aware Providers** | Check env before starting dev server | Don't start Vite in production |
| **Async DI Resolvers** | `container.singleton(key, async (resolver) => ...)` | Allows dependency chains in registration |

## Critical File References

| Component | Path | Key Lines |
|-----------|------|-----------|
| App Provider | `adonis-js/providers/app_provider.ts` | 98-101 (container), 216-244 (server), 353-366 (register) |
| Vite Provider | `adonisjs-vite-plugin/providers/vite_provider.ts` | 116-129 (register), 155-162 (ready) |
| HTTP Ignitor | `adonis-js/src/ignitor/http.ts` | 152-202 (startup) |
| Vite Class | `adonisjs-vite-plugin/src/vite.ts` | 492-508 (createDevServer), 223-279 (CSS) |
| Vite Middleware | `adonisjs-vite-plugin/src/vite_middleware.ts` | 51-94 (handle) |
| Edge Plugin | `adonisjs-vite-plugin/src/plugins/edge.ts` | 32-136 (template tags) |
| Client Plugin | `adonisjs-vite-plugin/src/client/main.ts` | 25-36 (plugin factory) |
| Build Hook | `adonisjs-vite-plugin/src/hooks/build_hook.ts` | 1-24 |
| Config Provider | `adonis-js/src/config_provider.ts` | 46-51 (create/resolve) |
