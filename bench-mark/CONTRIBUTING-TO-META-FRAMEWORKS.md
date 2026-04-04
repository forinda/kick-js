# The Complete Guide to Understanding Meta-Framework Code & Becoming an OSS Maintainer

---

## Part 1: How Framework Code Is Actually Written

Frameworks look intimidating because they compose many patterns together. Once you can identify the individual patterns, the code reads like prose. Here's every pattern you'll encounter, with **real examples from the codebases we analyzed**.

---

### 1.1 — The Kernel Pattern (Every Framework's Core)

Every framework has a "kernel" — a central object that bootstraps everything else. Understanding the kernel is understanding the framework.

```
NestJS:     NestFactory.create() → NestApplication (packages/core/nest-factory.ts)
AdonisJS:   Ignitor.createApp() → Application (src/ignitor/http.ts)
H3:         createH3() → H3 instance (src/h3.ts)
Vinxi:      createApp() → App object (packages/vinxi/lib/app.js)
React Router: reactRouterVitePlugin() → Vite plugin array (vite/plugin.ts)
KickJS:     bootstrap() → Application (packages/http/src/application.ts)
```

**The kernel always does 3 things in order:**
1. **Collect** — gather all modules/providers/plugins (NestJS scanner, AdonisJS providers, Vinxi routers)
2. **Wire** — resolve dependencies and connect everything (NestJS injector, AdonisJS container, Vinxi plugin composition)
3. **Start** — begin accepting requests (Express listen, H3 fetch, Nitro dev server)

**Exercise:** For any framework, find the kernel and trace these 3 phases. Draw a box diagram.

---

### 1.2 — Inversion of Control (IoC) — The Foundation of Everything

IoC is **the** core principle of every framework. The framework calls YOUR code, not the other way around.

**Three levels of IoC (from simple to complex):**

#### Level 1: Callback-Based IoC
```typescript
// H3 — simplest form. You give a function, framework calls it.
app.use('/api', (event) => {
  return { hello: 'world' }
})
```
**Where:** H3 handlers, Express middleware, Vite plugin hooks

#### Level 2: Convention-Based IoC
```typescript
// AdonisJS — framework discovers your code by file location
// app/controllers/users_controller.ts is auto-loaded
export default class UsersController {
  async index() { return 'users list' }
}
```
**Where:** AdonisJS controllers, Nuxt pages/, TanStack routes/, file-based routing

#### Level 3: Container-Based IoC (Dependency Injection)
```typescript
// NestJS / KickJS — framework manages object creation and wiring
@Controller('/users')
class UserController {
  constructor(
    private userService: UserService,  // Framework creates and injects this
    private logger: Logger,            // And this
  ) {}
}
```
**Where:** NestJS, KickJS, AdonisJS (@adonisjs/fold)

**Why it matters for reading framework code:** When you see a class with no `new` keyword anywhere, it's container-managed. The framework's injector creates it. To understand the wiring, find the container's `resolve()` method.

---

### 1.3 — The Container (DI) Internals — How It Actually Works

This is the most important system to understand for NestJS/KickJS-style frameworks.

#### Step 1: Registration Phase
```
@Service() decorator fires at class definition time
  → Reflect.defineMetadata(INJECTABLE_KEY, true, UserService)
  → Container.register('UserService', { metatype: UserService, scope: SINGLETON })
```

**NestJS implementation** (`packages/core/injector/module.ts:244`):
```typescript
addProvider(provider) {
  // Creates InstanceWrapper — the core unit that tracks each injectable
  const instanceWrapper = new InstanceWrapper({
    name: provider.name,
    metatype: provider,
    scope: getScope(provider),
    instance: null,        // Not created yet
    isResolved: false,     // Will be resolved later
  })
  this._providers.set(provider, instanceWrapper)
}
```

#### Step 2: Resolution Phase
```
Container.resolve('UserService')
  → Check: is it already resolved? Return cached instance.
  → No: what does UserService need?
    → Read constructor params via Reflect.getMetadata('design:paramtypes', UserService)
    → Returns [Logger, DatabaseService]
    → Recursively resolve Logger, DatabaseService
    → Create new UserService(resolvedLogger, resolvedDB)
    → Cache the instance
    → Return it
```

**NestJS implementation** (`packages/core/injector/injector.ts:128-205`):
```typescript
async loadInstance(wrapper, collection, moduleRef) {
  // 1. Already pending? Wait for it (prevents double-instantiation)
  if (wrapper.isPending) {
    return wrapper.donePromise
  }
  
  // 2. Mark as pending
  const signal = this.applySettlementSignal(wrapper)
  
  // 3. Resolve all constructor dependencies
  const dependencies = await this.resolveConstructorParams(wrapper, moduleRef)
  
  // 4. Create the actual instance
  const instance = await this.instantiateClass(dependencies, wrapper)
  
  // 5. Mark as resolved
  wrapper.instance = instance
  wrapper.isResolved = true
  signal.complete()
}
```

#### Step 3: Scope Management
```
SINGLETON:  One instance per container (default)
REQUEST:    One instance per HTTP request (via AsyncLocalStorage)
TRANSIENT:  New instance every time it's resolved
```

**NestJS uses WeakMap for request-scoped instances** (`instance-wrapper.ts:78`):
```typescript
private readonly values = new WeakMap<ContextId, InstancePerContext<T>>()
// When the request context is garbage-collected, so is the instance
```

**Key takeaway:** A DI container is just a Map<token, factory> with a recursive resolver and instance caching. That's it. Everything else is ergonomics.

---

### 1.4 — The Module System — How Code Is Organized

#### NestJS: Declarative Modules
```typescript
@Module({
  imports: [DatabaseModule],        // Dependencies from other modules
  controllers: [UserController],    // HTTP endpoints
  providers: [UserService],         // Business logic
  exports: [UserService],           // What other modules can use
})
class UserModule {}
```

**How it works internally** (`packages/core/scanner.ts`):
1. Scanner reads `@Module()` metadata via `Reflect.getMetadata()`
2. Recursively follows `imports` (building a DAG)
3. Calculates **module distance** (depth from root) for lifecycle ordering
4. Each module gets its own provider map (namespace isolation)

#### AdonisJS: Provider-Based Modules
```typescript
export default class AppProvider {
  register() {
    // Phase 1: bind to container (no cross-provider access)
    this.app.container.singleton(UserService, () => new UserService())
  }
  boot() {
    // Phase 2: cross-provider wiring (all bindings available)
  }
  ready() {
    // Phase 3: app is running (start background tasks)
  }
  shutdown() {
    // Phase 4: cleanup
  }
}
```

#### Vinxi: Router-Based Modules
```javascript
createApp({
  routers: [
    { name: 'api', type: 'http', handler: './api.ts', base: '/api' },
    { name: 'web', type: 'client', handler: './app.tsx', base: '/' },
  ]
})
// Each "router" = separate Vite instance + build target
```

**Key insight:** Module systems exist to answer: "What code belongs together, and what does it need from other groups?" Every framework answers this differently, but the question is the same.

---

### 1.5 — The Plugin/Hook System — Extensibility

#### Hook-Based (H3, Nuxt, Vinxi)
```typescript
// Hookable library — events at specific lifecycle points
app.hooks.hook('request', (event) => { /* before each request */ })
app.hooks.hook('error', (error) => { /* on error */ })
```

**How it works:** Just an `EventEmitter` with ordered execution. Hooks run in registration order. Some hooks are "waterfall" (each gets the previous result).

#### Plugin-Based (Vite)
```typescript
// Vite plugin — hooks into the build pipeline
export function myPlugin(): Plugin {
  return {
    name: 'my-plugin',
    configureServer(server) { /* modify dev server */ },
    transform(code, id) { /* modify source code */ },
    resolveId(id) { /* resolve import paths */ },
    load(id) { /* generate virtual modules */ },
  }
}
```

**Vite hook execution order:**
```
config → configResolved → configureServer → buildStart
→ [per module: resolveId → load → transform]
→ handleHotUpdate (dev) / generateBundle (build) → writeBundle
```

#### Adapter-Based (KickJS, NestJS)
```typescript
// KickJS AppAdapter — lifecycle interface
interface AppAdapter {
  name: string
  beforeMount?(ctx: AdapterContext): void
  beforeStart?(ctx: AdapterContext): void
  afterStart?(ctx: AdapterContext): void
  shutdown?(): Promise<void>
  middleware?(): AdapterMiddleware[]
}
```

**Key insight:** Plugins/hooks/adapters are all the **Strategy Pattern** — the framework defines WHEN code runs, you define WHAT it does.

---

### 1.6 — The Middleware Pipeline — Request Processing

Every HTTP framework has a middleware chain. The difference is how they compose.

#### Express/KickJS: Linear Chain
```
req → helmet → cors → requestId → bodyParser → routeHandler → res
         ↓        ↓         ↓           ↓             ↓
       next()   next()    next()      next()       send()
```

#### H3: Recursive next() Chain
```typescript
// H3's callMiddleware (src/middleware.ts:60-91)
function callMiddleware(event, middleware, handler, index = 0) {
  if (index === middleware.length) return handler(event)
  const next = () => callMiddleware(event, middleware, handler, index + 1)
  return middleware[index](event, next)
}
```

#### AdonisJS: Promise-Based Chain
```typescript
// Middleware returns void, calls next() to proceed
async handle(ctx: HttpContext, next: NextFn) {
  // Before handler
  await next()
  // After handler (response is ready)
}
```

**The key difference:** In Express, middleware is added to a flat array. In H3, middleware is a recursive call stack. In NestJS, middleware is ordered by module distance. The mental model matters for debugging.

---

### 1.7 — The Build Pipeline — How Source Becomes Runtime

```
Source Code (.ts)
    ↓
[Decorator Metadata] → Reflect.defineMetadata() at import time
    ↓
[Bundler Transform] → Vite/esbuild/tsc compiles TS → JS
    ↓
[Tree Shaking] → Remove unused exports (React Router removes server from client)
    ↓
[Code Splitting] → Split into chunks (route-based, ?pick= based)
    ↓
[Virtual Modules] → Generate modules that don't exist on disk
    ↓
[Output] → JS bundles ready for runtime
```

**Virtual modules** are the key innovation. React Router generates 3, TanStack generates 3+, Vinxi generates per-router manifests. They're the **bridge between build-time analysis and runtime behavior**.

```typescript
// Vite virtual module pattern
export function myPlugin(): Plugin {
  return {
    name: 'my-plugin',
    resolveId(id) {
      if (id === 'virtual:my-module') return '\0virtual:my-module'
    },
    load(id) {
      if (id === '\0virtual:my-module') {
        // Generate code dynamically
        return `export const modules = [${discovered.map(m => `() => import('${m}')`)}]`
      }
    }
  }
}
```

---

### 1.8 — HMR (Hot Module Replacement) — The Hard Problem

#### Strategy 1: Full Restart (NestJS, AdonisJS)
```
File change → kill process → respawn → re-bootstrap everything
Pros: Simple, always correct
Cons: Slow (2-5 seconds), loses all state
```

#### Strategy 2: Module Graph Invalidation (React Router, Nuxt)
```
File change → Vite detects → invalidate module + importers
→ Next ssrLoadModule() returns fresh code → no restart needed
Pros: Fast (<100ms), Vite handles complexity
Cons: Stale closures possible, memory leaks if not careful
```

#### Strategy 3: Dynamic Handler Swap (H3/Nuxt)
```typescript
// H3's dynamicEventHandler — atomic swap, zero downtime
const handler = dynamicEventHandler(initialHandler)
// Later, when code changes:
handler.set(newHandler) // Instant swap, no restart
```

#### Strategy 4: Reactive Proxy (KickJS's Goal)
```typescript
// Proposed: container registrations as reactive proxies
const service = container.resolve('UserService')
// When UserService module changes:
//   1. Vite invalidates the module
//   2. Container re-imports and re-instantiates
//   3. Proxy transparently returns new instance
//   4. Subscribers (DevTools, WS) notified
```

---

## Part 2: Dependency Analysis — How to Read Any Codebase

### 2.1 — The Package Graph

First thing to understand in any monorepo: **what depends on what**.

```bash
# For any pnpm monorepo, visualize the dependency graph:
pnpm ls -r --depth 0 --json | jq '.[].dependencies'

# Or use a tool:
npx turbo graph  # If using Turbo
```

**The frameworks' dependency graphs:**

```
NestJS:
  @nestjs/common → (standalone, decorators + interfaces)
  @nestjs/core → @nestjs/common (DI, scanner, lifecycle)
  @nestjs/platform-express → @nestjs/core + express

Nuxt:
  h3 → (standalone HTTP framework)
  nitro → h3 (server framework + deployment)
  @nuxt/vite → vite + nuxt (Vite integration)
  nuxt → @nuxt/vite + nitro + h3 (meta-framework)

Vinxi:
  vinxi → vite + nitropack + h3 + hookable (all-in-one)

React Router:
  react-router → (core routing)
  react-router-dev → react-router + vite (Vite plugin)
  react-router-express → react-router + express (adapter)
  react-router-node → react-router (Node.js runtime)
```

**Exercise:** Draw the dependency graph for KickJS. Find which package is the "root" that everything depends on. That's where to start reading.

### 2.2 — The Import Graph (Within a Package)

```bash
# Find what a specific file imports:
grep -n "^import" packages/core/injector/injector.ts

# Find what imports a specific file:
grep -rn "from.*injector" packages/core/

# Find the most-imported files (the "hubs"):
grep -rn "^import.*from" packages/core/src/ | \
  sed "s/.*from ['\"]//;s/['\"].*//" | sort | uniq -c | sort -rn | head -20
```

**The most-imported files are the most important files.** They're the interfaces that everything depends on. Read those first.

### 2.3 — The Call Graph (Runtime Flow)

**Technique: Trace a request end-to-end.**

For NestJS:
```
1. Express receives request
2. NestApplication.use() registered middleware runs
3. RoutesResolver finds matching controller
4. GuardsConsumer checks guards
5. InterceptorsConsumer wraps execution
6. PipesConsumer validates/transforms params
7. Controller method executes
8. ExceptionFiltersConsumer catches errors
9. Response sent
```

For H3:
```
1. H3Core.fetch(request) called
2. H3Event created from request
3. config.onRequest hook called
4. H3.handler(event) called
5. ~findRoute() matches URL
6. Global middleware collected
7. Route middleware collected
8. callMiddleware() recursive chain
9. Route handler executes
10. toResponse() converts result
11. config.onResponse hook called
```

**How to trace this yourself:**
```bash
# Method 1: grep for the entry function and follow calls
grep -n "async handler" packages/core/nest-application.ts

# Method 2: add console.trace() at a known point and read the stack
# (in the example app's controller)

# Method 3: use Node.js inspector
node --inspect-brk ./dist/main.js
# Then open chrome://inspect and set breakpoints
```

### 2.4 — The Lifecycle Graph (Initialization Order)

Every framework has a boot sequence. Document it.

**NestJS boot sequence (from nest-factory.ts):**
```
1. Create container (empty)
2. Create scanner
3. scanner.scan(AppModule)
   3a. Recursively discover all modules
   3b. For each: extract providers, controllers, injectables
   3c. Calculate module distance (depth from root)
   3d. Bind global modules
4. instanceLoader.createInstances()
   4a. Create prototypes (empty shells)
   4b. Resolve and inject dependencies (topological order)
5. applyApplicationProviders() — global guards, pipes, filters
6. registerModules() — middleware, WebSockets
7. registerRouter() — mount routes on Express
8. callInitHook() — OnModuleInit (ascending distance)
9. callBootstrapHook() — OnApplicationBootstrap
10. listen() — start accepting requests
```

**Exercise:** Write this for KickJS's `bootstrap()` function. Every step.

---

## Part 3: Design Patterns Deep Dive (With Framework Examples)

### 3.1 — Creational Patterns

#### Factory Method
**What:** Create objects without specifying the exact class.
**Where in frameworks:**
```typescript
// NestJS: FactoryProvider
{ provide: 'CONFIG', useFactory: (configService) => configService.get('db'), inject: [ConfigService] }

// AdonisJS: container.singleton with resolver
this.app.container.singleton(Server, async (resolver) => {
  const encryption = await resolver.make(Encryption)
  return new Server(this.app, encryption)
})

// Vite: plugin factory functions
export function reactRouterVitePlugin(): Plugin[] { return [...] }
```

#### Abstract Factory
**What:** Create families of related objects.
**Where:**
```typescript
// NestJS platform adapters — same interface, different implementations
NestFactory.create(AppModule, new ExpressAdapter())   // Express family
NestFactory.create(AppModule, new FastifyAdapter())   // Fastify family
// Both provide: listen(), reply(), registerMiddleware(), etc.
```

#### Singleton
**What:** Exactly one instance.
**Where:** Default scope in every DI container. Container itself is a singleton registry.
```typescript
// KickJS
@Service()  // Singleton by default
class DatabaseConnection {}
```

#### Builder
**What:** Construct complex objects step by step.
**Where:**
```typescript
// NestJS MiddlewareBuilder
const builder = new MiddlewareBuilder(routesMapper, httpAdapter)
module.configure(builder)
builder
  .apply(CorsMiddleware, LoggerMiddleware)
  .exclude('/health')
  .forRoutes('*')
const config = builder.build()
```

### 3.2 — Structural Patterns

#### Proxy
**What:** Substitute that controls access to another object.
**Where:**
```typescript
// NestJS: NestApplication is wrapped in a Proxy (nest-factory.ts:262-279)
return new Proxy(app, {
  get: (target, property) => {
    // Catch exceptions during method calls
    // Handle async errors
    // Auto-flush logs on errors
  }
})

// Vinxi: Dev manifest is a lazy proxy
const manifest = new Proxy({}, {
  get(target, routerName) {
    return loadRouterManifest(routerName) // Lazy-loaded
  }
})

// KickJS proposed: Reactive proxy on container registrations
```

#### Adapter
**What:** Make incompatible interfaces work together.
**Where:**
```typescript
// React Router: Express ↔ Fetch API adapter
function createRemixRequest(req: express.Request): Request {
  // Convert Express request to Web Fetch Request
  const url = `${protocol}://${host}${req.url}`
  return new Request(url, { method: req.method, headers: req.headers, body: ... })
}

function sendRemixResponse(res: express.Response, response: Response) {
  // Convert Web Fetch Response back to Express response
  res.status(response.status)
  response.headers.forEach((value, key) => res.setHeader(key, value))
  // Stream body...
}
```

#### Decorator (Structural, not TS decorators)
**What:** Add behavior to objects dynamically.
**Where:**
```typescript
// NestJS: InstanceWrapper wraps every provider
class InstanceWrapper<T> {
  metatype: Type<T>        // The original class
  instance: T              // The created instance
  scope: Scope             // Added behavior: lifecycle management
  isResolved: boolean      // Added behavior: resolution tracking
  donePromise: Promise     // Added behavior: async coordination
}
```

#### Composite
**What:** Tree structure where individual objects and compositions are treated the same.
**Where:**
```typescript
// NestJS module tree — each module can import other modules
@Module({ imports: [UserModule, AuthModule] })  // AuthModule also imports UserModule
class AppModule {}
// Scanner traverses this as a tree, deduplicating shared imports

// Vinxi: App is a composite of routers, each router is a composite of plugins
```

#### Facade
**What:** Simplified interface to a complex subsystem.
**Where:**
```typescript
// NestJS: NestFactory.create() is a facade over:
//   - Container creation
//   - Scanner initialization
//   - Instance loading
//   - Application configuration
// You just call: const app = await NestFactory.create(AppModule)

// AdonisJS: Ignitor is a facade over the entire boot sequence
```

### 3.3 — Behavioral Patterns

#### Chain of Responsibility (Middleware)
**What:** Pass request along a chain of handlers.
**Already covered in Section 1.6.** This is THE pattern for HTTP frameworks.

#### Observer / Pub-Sub
**What:** Object notifies dependents of state changes.
**Where:**
```typescript
// Vite HMR
server.hot.send({ type: 'custom', event: 'react-router:hmr', data })

// H3 hooks (via Hookable)
app.hooks.hook('request', handler)
app.hooks.callHook('request', event)

// KickJS proposed: container.subscribe('UserService', callback)
```

#### Strategy
**What:** Interchangeable algorithms.
**Where:**
```typescript
// Vinxi router modes — same interface, different strategies
const routerModes = {
  static: { dev: { handler(), plugins() }, build: { ... } },
  client: { dev: { handler(), plugins() }, build: { ... } },
  http:   { dev: { handler(), plugins() }, build: { ... } },
  spa:    { dev: { handler(), plugins() }, build: { ... } },
}
// resolveRouterConfig picks the right strategy by type
```

#### Template Method
**What:** Define the skeleton of an algorithm, let subclasses fill in steps.
**Where:**
```typescript
// Vinxi BaseFileSystemRouter (lib/fs-router.js)
class BaseFileSystemRouter {
  async buildRoutes() {          // Template: defined
    const files = glob(this.config.dir)
    return files.map(f => this.toRoute(f))
  }
  toRoute(file) { /* defined */ }
  toPath(file) { /* ABSTRACT — subclass must implement */ }
}

// SolidStart extends this with its own toPath() logic
```

#### Command
**What:** Encapsulate a request as an object.
**Where:**
```typescript
// AdonisJS Ace commands
export default class MakeController extends BaseCommand {
  static commandName = 'make:controller'
  static args = [{ name: 'name', required: true }]
  async run() { /* execute */ }
}

// KickJS CLI commands (kick g module, kick dev, etc.)
```

#### Mediator
**What:** Central object coordinates communication between objects.
**Where:**
```typescript
// NestJS Container — mediates between all modules
// No module talks directly to another; they go through the container
container.resolve('UserService') // Container knows where it lives

// Vinxi App — mediates between all routers
app.getRouter('api') // App knows all routers
```

### 3.4 — Concurrency Patterns

#### Barrier (Synchronization)
**What:** Wait for multiple async operations to complete before proceeding.
**Where:**
```typescript
// NestJS: Barrier in resolveConstructorParams (packages/core/helpers/barrier.ts)
// Ensures ALL constructor dependencies resolve before instantiation
const barrier = new Barrier()
barrier.add(dep1Promise, dep2Promise, dep3Promise)
await barrier.wait() // Only proceeds when all are ready
```

#### Settlement Signal
**What:** Track async resolution state without extra promises.
**Where:**
```typescript
// NestJS: SettlementSignal in instance-wrapper.ts
// Prevents duplicate instantiation attempts
// Detects circular dependencies
const signal = new SettlementSignal()
wrapper.donePromise = signal.asPromise()
// ... resolve dependencies ...
signal.complete() // or signal.error(err)
```

#### AsyncLocalStorage (Continuation-Local Storage)
**What:** Thread-local storage for async contexts.
**Where:**
```typescript
// Express request context, NestJS REQUEST scope
import { AsyncLocalStorage } from 'node:async_hooks'

const requestStore = new AsyncLocalStorage<RequestContext>()

// In middleware:
requestStore.run({ requestId, user, ... }, () => next())

// Anywhere in the call stack:
const ctx = requestStore.getStore() // Gets current request's context
```

---

## Part 4: Advanced Concepts for Framework Engineering

### 4.1 — Metaprogramming with reflect-metadata

This is how TypeScript decorators store and retrieve type information.

```typescript
import 'reflect-metadata'

// STORING metadata (what decorators do)
function Service(): ClassDecorator {
  return (target) => {
    Reflect.defineMetadata('injectable', true, target)
  }
}

function Inject(token: string): ParameterDecorator {
  return (target, propertyKey, parameterIndex) => {
    const existing = Reflect.getMetadata('inject:params', target) || []
    existing[parameterIndex] = token
    Reflect.defineMetadata('inject:params', existing, target)
  }
}

// READING metadata (what the container does)
function resolve(target: any) {
  // Get constructor parameter types (TypeScript emits this)
  const paramTypes = Reflect.getMetadata('design:paramtypes', target) || []
  // Get custom injection tokens
  const injectTokens = Reflect.getMetadata('inject:params', target) || []
  
  // Merge: custom tokens override auto-detected types
  const deps = paramTypes.map((type, i) => injectTokens[i] || type)
  
  // Recursively resolve each dependency
  const resolved = deps.map(dep => resolve(dep))
  
  // Create the instance
  return new target(...resolved)
}
```

**Critical fact:** `Reflect.getMetadata('design:paramtypes', MyClass)` only works if:
1. `emitDecoratorMetadata: true` in tsconfig
2. The class has at least one decorator applied
3. You're using legacy/experimental decorators (Stage 3 decorators don't emit this)

### 4.2 — Module Graph Theory

A module graph is a **directed graph** where:
- Nodes = files/modules
- Edges = import statements

**Key operations:**

```
Topological Sort:
  Given: A imports B, B imports C
  Order: C → B → A (dependencies first)
  Used by: NestJS instance loader, Vite build order

Cycle Detection:
  If A imports B and B imports A → circular dependency
  NestJS uses forwardRef() to handle this
  Vite uses lazy evaluation

Invalidation Walk:
  File C changed → find all importers of C (B, A) → mark all as stale
  Nuxt does this for HMR (vite-node.ts:157-180)

Reachability:
  Can module X reach module Y through imports?
  Used for: tree shaking, import protection (TanStack)
```

**Exercise:** Draw the module graph for one KickJS example app. Which module is the root? Which has the most importers?

### 4.3 — AST (Abstract Syntax Tree) Manipulation

Frameworks that do code transformation (TanStack Start, React Router, Vinxi) use AST manipulation.

```typescript
// What TanStack Start does with createServerFn:

// Input:
const getUser = createServerFn().handler(async (ctx) => {
  return db.user.findUnique({ where: { id: ctx.data.id } })
})

// AST transformation for CLIENT:
const getUser = createClientRpc('getUser_abc123')
// Removes server code, replaces with HTTP fetch stub

// AST transformation for SERVER:
const getUser = createServerRpc({ functionId: 'getUser_abc123' }, async (ctx) => {
  return db.user.findUnique({ where: { id: ctx.data.id } })
})
```

**Tools:**
- **Babel** — most mature, used by TanStack/Vinxi for transforms
- **SWC** — faster, used by NestJS for dev builds
- **esbuild** — fastest, used by Vite for transforms
- **es-module-lexer** — lightweight, only parses imports/exports (used by Vinxi)

### 4.4 — The Proxy/Reactive Pattern (For KickJS)

How Vue's reactivity works (simplified), which KickJS wants to adopt:

```typescript
// Vue's ref() — simplified
function ref<T>(value: T) {
  const subscribers = new Set<() => void>()
  
  return new Proxy({ value }, {
    get(target, key) {
      if (key === 'value') {
        // Track: who is reading this?
        if (activeEffect) subscribers.add(activeEffect)
        return target.value
      }
    },
    set(target, key, newValue) {
      if (key === 'value') {
        target.value = newValue
        // Trigger: notify everyone who read this
        subscribers.forEach(fn => fn())
        return true
      }
      return false
    }
  })
}

// Usage
const count = ref(0)
effect(() => {
  console.log(count.value) // Automatically subscribes
})
count.value = 1 // Automatically triggers the effect
```

**For KickJS's container:**
```typescript
// Instead of ref(), wrap registrations
function reactiveRegistration(token, factory) {
  const subscribers = new Set<(newInstance: any) => void>()
  let instance = null
  
  return {
    resolve() {
      if (!instance) instance = factory()
      return instance
    },
    invalidate() {
      instance = null              // Clear cached instance
      instance = factory()         // Re-create
      subscribers.forEach(fn => fn(instance))  // Notify
    },
    subscribe(fn) {
      subscribers.add(fn)
      return () => subscribers.delete(fn)
    }
  }
}
```

---

## Part 5: Becoming an OSS Maintainer — The Real Path

### 5.1 — The Contribution Ladder

```
Level 0: USER
  → Use the framework, file issues, answer questions on Discord/GitHub

Level 1: CONTRIBUTOR (3-6 months)
  → Fix typos, improve docs, add tests
  → Fix bugs from "good first issue" labels
  → Review other people's PRs (even without merge access)

Level 2: REGULAR CONTRIBUTOR (6-12 months)
  → Own a specific area (e.g., "the CLI", "the Vite plugin", "the auth module")
  → Propose and implement features with RFCs
  → Triage issues (label, reproduce, close duplicates)
  → Mentor new contributors

Level 3: COLLABORATOR (12-18 months)
  → Get write access to the repo
  → Review and merge PRs
  → Participate in architecture decisions
  → Release management

Level 4: MAINTAINER (18+ months)
  → Set project direction
  → Make breaking change decisions
  → Manage the community
  → Onboard new collaborators
```

### 5.2 — Tactical Steps to Get There

#### Week 1-2: Become a Power User
```bash
# Build the project from source
git clone <repo> && pnpm install && pnpm build && pnpm test

# Read CONTRIBUTING.md, CODE_OF_CONDUCT.md, ARCHITECTURE.md
# Read the last 50 merged PRs to understand what's happening

# Join the community Discord/Slack
# Read without posting for a week — understand the culture
```

#### Week 3-4: Your First Contributions
```
Target: 3-5 small PRs that get merged

Good targets:
1. Fix a typo in docs
2. Add a missing test case
3. Improve an error message
4. Fix a "good first issue" bug
5. Add type annotations to untyped code

Bad targets (too early):
- "I refactored the whole module system"
- "I added a feature nobody asked for"
- "I changed the code style to my preference"
```

#### Month 2-3: Build Reputation
```
- Consistently respond to issues (reproduce bugs, suggest fixes)
- Review PRs thoughtfully (not just "LGTM" — point out edge cases)
- Write a blog post about something you learned from the codebase
- Propose a small feature via an issue BEFORE writing code
```

#### Month 4-6: Own an Area
```
Pick ONE area of the codebase and become the expert:
- "I know every line of the CLI"
- "I maintain the Prisma adapter"
- "I wrote the test infrastructure"

This is what gets you collaborator access.
```

### 5.3 — What Maintainers Actually Look For

```
✅ DO:
  - Write tests for everything you touch
  - Follow existing patterns even if you disagree
  - Communicate before coding (issue → discussion → PR)
  - Be patient with review cycles
  - Help other contributors (answer questions, review PRs)
  - Accept feedback gracefully (even harsh feedback)

❌ DON'T:
  - Send massive unsolicited refactoring PRs
  - Argue about code style
  - Demand your PR be merged quickly
  - Break existing tests without explanation
  - Add dependencies without discussion
  - Ghost after starting something
```

### 5.4 — Practical OSS Workflow

```bash
# 1. Fork and clone
gh repo fork <org>/<repo> --clone

# 2. Create branch from latest main
git checkout main && git pull upstream main
git checkout -b fix/issue-123-description

# 3. Make changes + tests
# (always run the full test suite before pushing)
pnpm test

# 4. Commit with conventional format
git commit -m "fix(cli): handle spaces in module names (#123)"

# 5. Push and create PR
git push -u origin fix/issue-123-description
gh pr create --base main

# 6. Address review feedback
# (push new commits, don't force-push during review)
git commit -m "address review: add edge case test"
git push

# 7. After merge, clean up
git checkout main && git pull upstream main
git branch -d fix/issue-123-description
```

### 5.5 — Per-Project Entry Points

| Project | Best First Area | Why | Discord/Community |
|---------|----------------|-----|-------------------|
| **NestJS** | `packages/common/decorators/` | Small, self-contained files | discord.gg/nestjs |
| **Nuxt** | `packages/nuxt/src/core/` | Well-documented, typed | discord.nuxt.dev |
| **React Router** | `packages/react-router/lib/` | Pure logic, no build tool deps | discord.gg/reactrouter |
| **AdonisJS** | Any addon package | Isolated, clear interfaces | discord.gg/adonisjs |
| **TanStack** | `packages/router-generator/` | Code gen, easy to test | tlinz.com/discord |
| **Vinxi** | Test coverage (very low) | Huge impact, learn by testing | — |
| **H3** | `src/utils/` | Small utility functions | discord.gg/unjs |

---

## Part 6: Algorithms & Data Structures You Need

### Must-Know (Used Daily in Frameworks)

| Concept | Where It's Used | Learn It By |
|---------|----------------|-------------|
| **Hash Map** | DI container (token → instance), module registry | Implement a simple DI container |
| **DAG (Directed Acyclic Graph)** | Module dependencies, import graph | Implement topological sort |
| **Tree Traversal (BFS/DFS)** | Module scanning, middleware chain, component tree | Trace NestJS's scanner |
| **Topological Sort** | Build order, lifecycle hook order, dependency resolution | Sort KickJS modules by depth |
| **Trie / Radix Tree** | URL routing (H3's rou3, Express's path-to-regexp) | Build a simple URL router |
| **Observer Pattern** | Event emitters, HMR, reactive state | Build a simple EventEmitter |
| **WeakMap / WeakRef** | Request-scoped instances, cache with auto-GC | NestJS's context management |
| **Proxy / Reflect** | Reactive state, lazy loading, validation | Build Vue's ref() from scratch |

### Good-to-Know (Used in Build Tools)

| Concept | Where It's Used |
|---------|----------------|
| **AST Parsing** | Code transformation (Babel, SWC), tree shaking |
| **Regular Expressions** | Route matching, file pattern matching |
| **Streaming / Backpressure** | SSR rendering, file upload, response streaming |
| **Concurrent Queue** | Build orchestration, parallel test execution |
| **LRU Cache** | Module caching, template caching |
| **Binary Protocol** | Nuxt's vite-node IPC (4-byte length + JSON) |
| **Glob Matching** | File discovery, route generation |
| **Semver** | Version resolution, dependency management |

### The Exercise That Teaches Everything

**Build a mini-framework from scratch (in this order):**

```
1. HTTP server that matches routes (Trie/Map)
2. Middleware chain (Chain of Responsibility)
3. DI container with @Service/@Inject (reflect-metadata + Map + recursive resolve)
4. Module system with @Module (DAG + topological sort)
5. Lifecycle hooks (Observer pattern)
6. Vite plugin that generates a virtual module from decorators
7. HMR via ssrLoadModule() in the Vite plugin
8. Reactive proxy on the container that notifies on change

After step 8, you've built a mini-KickJS. You'll understand every framework we analyzed.
```

---

## Part 7: Recommended Study Order

### Phase 1: Foundations (2-4 weeks)
- [ ] Read H3 source (smallest, cleanest — ~1000 LOC total)
- [ ] Read Vite Plugin API docs end-to-end
- [ ] Build exercises 1-3 from Part 6
- [ ] File 2 documentation PRs to any project

### Phase 2: DI & Modules (2-4 weeks)
- [ ] Read NestJS `packages/core/injector/` (the whole directory)
- [ ] Read AdonisJS `providers/app_provider.ts`
- [ ] Build exercises 4-5
- [ ] Fix 2 "good first issue" bugs

### Phase 3: Build Tools & HMR (2-4 weeks)
- [ ] Read React Router `vite/plugin.ts` (the whole 3900 lines)
- [ ] Read Vinxi `lib/dev-server.js` + `lib/router-modes.js`
- [ ] Build exercises 6-7
- [ ] Propose a small feature to one project

### Phase 4: Advanced (ongoing)
- [ ] Read Nuxt `packages/vite/src/vite-node.ts` (IPC protocol)
- [ ] Read TanStack `start-compiler-plugin/` (AST transformation)
- [ ] Build exercise 8 (reactive container)
- [ ] Own an area in one project → path to collaborator
