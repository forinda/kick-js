# NestJS Architecture Analysis

## Overview

NestJS is a decorator-driven Node.js framework built on Express/Fastify with a sophisticated DI container, module system, and lifecycle management. It does **NOT** have built-in Vite or HMR support — it relies on external Webpack configuration for hot-reload.

## Architecture Diagram

```
User Code (main.ts)
    |
NestFactory.create(AppModule)
    |
Initialize:
  +-- DependenciesScanner.scan()
  |   +-- scanForModules() --> Build module graph (recursive)
  |   +-- scanModulesForDependencies() --> Extract providers, controllers
  |   +-- calculateModulesDistance() --> Determine execution order
  |   +-- bindGlobalScope() --> Link global modules
  +-- InstanceLoader.createInstancesOfDependencies()
  |   +-- createPrototypes() --> Create prototype objects
  |   +-- createInstances() --> Instantiate with DI
  |      +-- Injector.loadProvider() --> Resolve deps
  |      +-- Injector.loadController() --> Same for controllers
  |      +-- Injector.loadInjectable() --> Guards/pipes/etc
  +-- applyApplicationProviders() --> Global enhancers
    |
NestApplication.init()
  +-- registerModules() --> WebSockets, microservices, middleware
  +-- registerRouter() --> Mount routes with middleware
  +-- callInitHook() --> OnModuleInit for all modules
  +-- registerRouterHooks() --> 404 & exception handlers
  +-- callBootstrapHook() --> OnApplicationBootstrap
    |
app.listen(3000)
  +-- httpAdapter.listen()
  +-- Request --> Global middleware --> Route middleware --> Handler
    |
app.close()
  +-- callDestroyHook() --> OnModuleDestroy (reverse order)
  +-- callBeforeShutdownHook() --> BeforeApplicationShutdown
  +-- dispose() --> Close HTTP server
  +-- callShutdownHook() --> OnApplicationShutdown
```

## Dev Server / HMR Strategy

**No built-in HMR.** NestJS uses external Webpack with polling:

```javascript
// webpack-hmr.config.js (sample/08-webpack/)
entry: ['webpack/hot/poll?100', options.entry]
plugins: [
  new webpack.HotModuleReplacementPlugin(),
  new webpack.WatchIgnorePlugin({ paths: [/\.js$/, /\.d\.ts$/] })
]
```

The main.ts then has:
```typescript
if (module.hot) {
  module.hot.accept()
  module.hot.dispose(() => app.close())
}
```

**Key insight:** The entire NestApplication is torn down and recreated on each HMR update. There's no surgical module replacement — it's a full app restart within the same process.

## DI Container Lifecycle

### InstanceWrapper — Core Data Structure
**File:** `packages/core/injector/instance-wrapper.ts`

Every injectable, controller, and provider is wrapped in `InstanceWrapper<T>`:

```typescript
// Key properties:
- name: any                    // Identifier
- token: InjectionToken        // Injection token
- metatype: Type<T>           // The actual class
- scope: Scope                // DEFAULT (singleton), REQUEST, TRANSIENT
- instance: T                 // The resolved instance
- forwardRef?: boolean        // Circular dependency flag
- durable?: boolean           // For REQUEST-scoped providers
```

**Context management:** Instances stored in `WeakMap<ContextId, InstancePerContext<T>>`. Transient instances use additional `transientMap` for per-inquirer isolation. WeakMap enables automatic GC of request-scoped instances.

### Injector — DI Resolution Engine
**File:** `packages/core/injector/injector.ts`

**Resolution flow (`loadInstance` method):**

1. **Check if already pending** — detect circular dependencies via `SettlementSignal`
2. **Create settlement signal** — tracks async resolution state
3. **Resolve dependencies** — constructor params via `resolveConstructorParams()`, property injection via `resolveProperties()`
4. **Instantiate** — `instantiateClass()` with resolved deps
5. **Mark resolved** — `isResolved = true`, signal settlement

**Barrier Pattern** for synchronization:
- Used in `resolveConstructorParams()` to ensure all dependencies resolve before instantiation
- Prevents race conditions in circular dependency scenarios
- Located in `packages/core/helpers/barrier.ts`

**Component resolution chain:**
```
resolveComponentWrapper()
  --> lookupComponent()                    // Module's own providers
  --> lookupComponentInParentModules()      // Walk import tree
  --> lookupComponentInImports()            // Recursive with cycle detection
```

### Module — Provider Registry
**File:** `packages/core/injector/module.ts`

Each module maintains:
```typescript
_providers: Map<InjectionToken, InstanceWrapper>    // All providers
_injectables: Map<InjectionToken, InstanceWrapper>  // Guards, pipes, interceptors
_middlewares: Map<InjectionToken, InstanceWrapper>   // Route middleware
_controllers: Map<InjectionToken, InstanceWrapper>   // Controllers
_imports: Set<Module>                                // Imported modules
_exports: Set<InjectionToken>                        // Re-exported tokens
```

### NestContainer — Module Manager
**File:** `packages/core/injector/container.ts`

```typescript
globalModules: Set<Module>                           // Global scope
modules: ModulesContainer                            // All modules by token
dynamicModulesMetadata: Map<string, DynamicModule>   // Dynamic metadata
```

## Module System

### @Module() Decorator
**File:** `packages/common/decorators/modules/module.decorator.ts`

```typescript
export function Module(metadata: ModuleMetadata): ClassDecorator {
  return (target: Function) => {
    for (const property in metadata) {
      Reflect.defineMetadata(property, (metadata as any)[property], target)
    }
  }
}
```

Simply stores metadata keys: `imports`, `controllers`, `providers`, `exports`.

### Scanner — Three-Phase Discovery
**File:** `packages/core/scanner.ts`

1. **registerCoreModule()** — bootstrap internal modules
2. **scanForModules()** — recursive module tree traversal (handles circular deps)
3. **scanModulesForDependencies()** — for each module: reflectImports, reflectProviders, reflectControllers, reflectExports

**Module distance calculation:** Converts modules to an acyclic topology tree. Distance = depth from root. Used to order lifecycle hook execution.

## Lifecycle Hooks

**Execution order:**
1. `OnModuleInit` — distance ascending (root first)
2. `OnApplicationBootstrap` — same pattern
3. `OnModuleDestroy` — distance **descending** (leaf first)
4. `BeforeApplicationShutdown` — with optional signal param
5. `OnApplicationShutdown` — final cleanup

Global modules have `distance = Number.MAX_VALUE` — initialized first, destroyed last.

## Middleware Pipeline

**File:** `packages/core/middleware/middleware-module.ts`

Two-phase setup:
1. **loadConfiguration** — call each module's `configure()` with `MiddlewareBuilder`
2. **registerMiddleware** — sort by module distance (globals first), register with HTTP adapter

**Execution order:** Global middleware --> Non-global middleware (by distance) --> Route handlers --> 404 --> Exception filters

## Express Platform
**File:** `packages/platform-express/adapters/express-adapter.ts`

```typescript
constructor(instance?: any) {
  super(instance || express())
  this.instance.use((req, res, next) => {
    if (this.onResponseHook) res.on('finish', () => this.onResponseHook(req, res))
    if (this.onRequestHook) this.onRequestHook(req, res, next)
    else next()
  })
}
```

## Key Patterns for KickJS

| Pattern | Description | KickJS Application |
|---------|-------------|-------------------|
| Distance-Based Ordering | Modules have computed depth from root — determines lifecycle order | Deterministic module initialization |
| SettlementSignal | Tracks async resolution, detects circular deps | Essential for request-scoped DI |
| WeakMap Context | `WeakMap<ContextId, InstancePerContext>` for auto-GC | Better than manual cleanup for request scope |
| Barrier Pattern | Wait for all constructor params before instantiation | Prevents race conditions in async DI |
| Full-App HMR Teardown | `app.close()` + recreate on every change | KickJS's reactive proxy can be much better |
| Three-Phase Scan | Register, resolve, apply — separate phases | More robust than single-pass |
