# Vite Integration, Server HMR & Build System - Lessons for KickJS

> Research notes from introspecting the React Router v7 codebase (`packages/react-router-dev/vite/`),
> focusing on **server-side patterns** applicable to KickJS: Vite plugin architecture, server module
> hot-reload, build tooling, type generation, and DI container HMR improvements.
>
> **Build tooling recommendation updated**: tsdown (Rolldown/Rust-based) over tsup (esbuild-based)
> for KickJS's next build system. See Section 10 for rationale.
>
> Frontend/browser-specific patterns (React Refresh, client bundles, CSS extraction, SSR hydration)
> are omitted - KickJS is a server-side Node.js framework.

---

## Table of Contents

1. [Vite Plugin Architecture](#1-vite-plugin-architecture)
2. [Server-Side HMR via Vite](#2-server-side-hmr-via-vite)
3. [Dev Server Setup](#3-dev-server-setup)
4. [Virtual Module System](#4-virtual-module-system)
5. [Server Build Pipeline](#5-server-build-pipeline)
6. [Server Reload Mechanisms](#6-server-reload-mechanisms)
7. [Designing a KickJS Vite Plugin](#7-designing-a-kickjs-vite-plugin)
8. [React Router Build System Deep Dive (tsup)](#8-react-router-build-system-deep-dive-tsup)
9. [Runtime Type Generation (Typegen)](#9-runtime-type-generation-typegen)
10. [KickJS Build System - Current State & Improvements](#10-kickjs-build-system---current-state--improvements)
11. [tsdown: The Next-Gen Alternative to tsup](#11-tsdown-the-next-gen-alternative-to-tsup)
12. [Removing Turbo: pnpm + wireit](#12-removing-turbo-pnpm--wireit)
13. [Diagrams](#13-diagrams)
14. [Vite vs tsdown: Where Each Tool Lives](#14-vite-vs-tsdown-where-each-tool-lives)
15. [DevTools Improvements](#15-devtools-improvements-why-classes-show-as-not-instantiated)

---

## 1. Vite Plugin Architecture

React Router's Vite integration lives in `packages/react-router-dev/vite/plugin.ts` (~4330 lines). The main export `reactRouterVitePlugin()` returns an **array of 14+ Vite plugins**, each with a focused responsibility.

**Server-relevant plugins:**

| Plugin Name | Responsibility |
|---|---|
| `react-router` | Core config, environment setup, child compiler init |
| `react-router:virtual-modules` | Resolves/loads virtual modules (server-build, manifests) |
| `react-router:route-exports` | Analyzes route module exports via Babel AST |
| `react-router:hmr-updates` | Detects module metadata changes, sends custom HMR events |
| `react-router:dot-server` | Validates server-only file boundaries |

### Key Pattern: Plugin Array Composition

Rather than one monolithic plugin, React Router composes many small plugins into an array. This:
- Keeps each plugin focused and testable
- Allows plugins to run at different Vite lifecycle stages
- Makes it easy to conditionally include plugins (e.g., HMR plugins only in `serve` mode)

```typescript
// Simplified pattern
export function reactRouterVitePlugin(options): Vite.Plugin[] {
  let ctx = createPluginContext(options);
  return [
    corePlugin(ctx),
    virtualModulesPlugin(ctx),
    hmrPlugin(ctx),
    moduleExportsPlugin(ctx),
    // ...
  ];
}
```

### Child Compiler

React Router creates a **second Vite dev server** (child compiler) specifically for analyzing modules without polluting the main dev server's module graph:

```typescript
viteChildCompiler = await vite.createServer({
  ...viteUserConfig,
  cacheDir: "node_modules/.vite-child-compiler",
  server: {
    preTransformRequests: false,
    hmr: false, // No HMR for the analyzer
  },
  plugins: [/* excludes react-router plugin to avoid infinite loop */],
});
```

This is used to:
- Parse files and extract export names (loader, action, middleware, etc.)
- Compile modules through Vite's transform pipeline for metadata extraction
- Keep the analysis isolated from the running dev server

---

## 2. Server-Side HMR via Vite

React Router's server HMR detects **module metadata changes** and coordinates updates without restarting the process.

### How handleHotUpdate Works (Server-Side)

When a file changes, the Vite plugin compares old vs new module metadata:

```typescript
// plugin.ts - "react-router:hmr-updates" plugin
handleHotUpdate({ file, server }) {
  let route = getRoute(ctx.reactRouterConfig, file);
  if (!route) return;

  let oldMetadata = currentManifest[route.id];
  let newMetadata = await getRouteMetadata(ctx, viteChildCompiler, route);

  // Compare: hasLoader, hasAction, hasMiddleware, etc.
  let metadataChanged = !isEqual(oldMetadata, newMetadata);

  if (metadataChanged) {
    invalidateVirtualModules(server); // Force re-generation of virtual modules
    server.hot.send({
      type: "custom",
      event: "react-router:hmr",
      data: { route: newMetadata },
    });
  }
}
```

### Server HMR Flow

```
File Change
  -> Vite detects change, invalidates module in SSR module graph
  -> handleHotUpdate() fires
  -> Module metadata compared (old vs new exports)
  -> Virtual modules invalidated (server-build, manifests)
  -> Next request loads fresh modules via ssrLoadModule() / runner.import()
  -> New server code handles request immediately
  -> No process restart needed
```

The critical insight: **Vite's SSR module graph tracks dependencies**. When a file changes, Vite invalidates it and all its importers. The next `ssrLoadModule()` call re-evaluates the module chain, giving you fresh code without a process restart.

---

## 3. Dev Server Setup

### Entry Point (`vite/dev.ts`)

```typescript
export async function dev(root: string, options: DevOptions) {
  let viteDevServer = await vite.createServer({ root, ...options });
  // Validate react-router plugin is loaded
  await viteDevServer.listen(port);
}
```

### Server Middleware (`configureServer` hook in plugin.ts)

The plugin installs Express-compatible middleware on Vite's dev server:

```typescript
configureServer(viteDevServer) {
  // 1. Setup dev server hooks (error stack traces)
  setDevServerHooks({
    processRequestError: (error) => { viteDevServer.ssrFixStacktrace(error); },
  });

  // 2. Watch config for changes
  configLoader.onChange(({ routeConfigChanged }) => {
    if (routeConfigChanged) {
      invalidateVirtualModules(viteDevServer);
    }
  });

  // 3. Request handler middleware
  return () => {
    viteDevServer.middlewares.use(async (req, res, next) => {
      // Load server build module (fresh on each request in dev)
      let build = await ssrEnvironment.runner.import("virtual:react-router/server-build");
      let handler = createRequestHandler(build, "development");
      await nodeHandler(req, res);
    });
  };
}
```

Key insight: **every request loads a fresh server build** in dev mode via `ssrLoadModule()` (Vite v5) or `runner.import()` (Vite v6+), ensuring server code changes are immediately reflected without restart.

### Module Loading Strategies

**Vite v6+ (Environment API):**
```typescript
let ssrEnvironment = viteDevServer.environments.ssr;
build = await ssrEnvironment.runner.import(virtual.serverBuild.id);
```

**Vite v5 (Legacy):**
```typescript
build = await viteDevServer.ssrLoadModule(virtual.serverBuild.id);
```

Both approaches give you fresh module evaluation on each call after invalidation.

---

## 4. Virtual Module System

React Router uses Vite's virtual module convention (`\0` prefix) to generate code dynamically:

```typescript
let virtual = {
  serverBuild:    VirtualModule.create("server-build"),
  serverManifest: VirtualModule.create("server-manifest"),
};
```

### Server Build Virtual Module

Generated dynamically based on config, aggregating all modules into a single importable entry:

```typescript
// Generated code (simplified)
import * as entryServer from "./entry.server.ts";
import * as route0 from "./routes/users.ts";
import * as route1 from "./routes/tasks.ts";

export const routes = {
  "routes/users": { id: "routes/users", path: "/users", module: route0 },
  "routes/tasks": { id: "routes/tasks", path: "/tasks", module: route1 },
};
```

### Invalidation

When config changes, all virtual modules are invalidated in Vite's module graph:

```typescript
function invalidateVirtualModules(viteDevServer) {
  Object.values(virtual).forEach((vmod) => {
    let mod = viteDevServer.moduleGraph.getModuleById(vmod.resolvedId);
    if (mod) viteDevServer.moduleGraph.invalidateModule(mod);
  });
}
```

This forces Vite to re-execute the virtual module's `load()` hook on next import, picking up new config. **This is the pattern KickJS should adopt for auto-discovering `@Service`/`@Controller` classes.**

---

## 5. Server Build Pipeline

### Build Strategy

**Vite v8 (Environment API):**
```typescript
let builder = await vite.createBuilder(viteConfig);
await builder.buildApp(); // Builds all environments in one pass
```

**Vite v5 (separate builds):**
```typescript
// Server builds can run in parallel for multiple bundles
await Promise.all(
  serverBundles.map(bundle => viteBuild({ ...config, environment: bundle.id }))
);
```

### Build Manifest Generation

After build, React Router generates a manifest mapping modules to their built assets:

```typescript
// Reads Vite's .vite/manifest.json
// For each module: extracts JS chunks and dependencies
// Generates SRI (Subresource Integrity) hashes for all JS files
```

---

## 6. Server Reload Mechanisms

### Config File Watching

```typescript
configLoader.onChange(({ configChanged, routeConfigChanged }) => {
  if (configChanged || routeConfigChanged) {
    invalidateVirtualModules(viteDevServer);
    // Log changes to dev terminal
  }
});
```

### Module-Level Server Reload

In dev mode, the server build is loaded via `ssrLoadModule()` or `runner.import()`. Since Vite tracks the module graph:

1. File changes -> Vite invalidates the module in its SSR module graph
2. Next request triggers `ssrLoadModule()` which re-evaluates the module
3. The new server code handles the request

**No process restart needed** - this is pure module-level hot swap.

### Why This Matters for KickJS

KickJS currently does a full `Container._onReset()` on every file change, replaying ALL decorator registrations. React Router's approach is more surgical:
- Only invalidate what changed (via Vite's module graph)
- Only re-evaluate on next use (lazy, not eager)
- Virtual modules regenerate only when metadata actually changed

---

## 7. Designing a KickJS Vite Plugin

Based on React Router's patterns, here's how a `@forinda/kickjs-vite` plugin could work for a **server-side Node.js framework**:

### 7.1 Plugin Structure (Array Composition)

```typescript
// packages/vite/src/plugin.ts
export function kickjsVitePlugin(options?: KickJSPluginOptions): Vite.Plugin[] {
  let ctx = createPluginContext(options);
  return [
    kickjsCorePlugin(ctx),           // Config, SSR environment setup
    kickjsVirtualModules(ctx),       // Virtual module resolution
    kickjsModuleDiscovery(ctx),      // Auto-discover @Controller, @Service, etc.
    kickjsHmrPlugin(ctx),           // DI container selective invalidation
    kickjsDevServerPlugin(ctx),      // Express dev server middleware
  ];
}
```

### 7.2 Virtual Modules for KickJS

```typescript
// Virtual module: virtual:kickjs/app-modules
// Generated from scanning decorated classes
import { UserModule } from "./src/modules/users/user.module";
import { TaskModule } from "./src/modules/tasks/task.module";

export const modules = [UserModule, TaskModule];
export const config = { /* kick.config.ts contents */ };
```

```typescript
// Virtual module: virtual:kickjs/container-registry
// Auto-generated DI registrations from decorator scanning
import { UserService } from "./src/modules/users/user.service";
import { UserRepository } from "./src/modules/users/user.repository";

export function registerAll(container: Container) {
  container.register("UserService", UserService, Scope.SINGLETON);
  container.register("UserRepository", UserRepository, Scope.SINGLETON);
}
```

### 7.3 HMR Strategy for Server-Side DI

The key challenge for KickJS is **resetting the DI container** on HMR without losing connections (DB, Redis, WebSocket).

**Approach (selective invalidation instead of full reset):**

```typescript
// kickjs-hmr plugin
handleHotUpdate({ file, server }) {
  let isModule = isKickModule(file);       // @Controller, @Service, etc.
  let isConfig = isKickConfig(file);       // kick.config.ts

  if (isModule) {
    // 1. Invalidate the virtual:kickjs/container-registry module
    invalidateVirtualModules(server);

    // 2. Selective DI invalidation (not full reset)
    let token = getTokenForFile(file);
    let affected = container.getDependentsOf(token);
    for (const t of [token, ...affected]) {
      container.invalidate(t);
    }
  }

  if (isConfig) {
    // Full server restart for config changes
    server.restart();
  }
}
```

**Bootstrap HMR acceptance (existing pattern, enhanced):**

```typescript
// src/index.ts (app entry)
import { bootstrap } from "@forinda/kickjs-http";

const app = bootstrap({ modules: [UserModule, TaskModule] });

if (import.meta.hot) {
  import.meta.hot.accept(() => {
    // Selective container invalidation instead of full _onReset()
    // Express handler swapped without restarting HTTP server
    // DB/Redis connections preserved via globalThis.__app
    app.rebuild();
  });
}
```

### 7.4 Module Discovery via Vite Transform

Instead of runtime decorator scanning, the Vite plugin can do **build-time module discovery**:

```typescript
// In the transform hook, detect @Controller/@Service decorators
transform(code, id) {
  if (hasDecoratorImport(code, "@forinda/kickjs-core")) {
    let decorators = extractDecorators(code); // AST parse
    ctx.registeredModules.set(id, decorators);
    // Regenerate virtual:kickjs/container-registry
    invalidateVirtualModules(server);
  }
  return code;
}
```

### 7.5 Dev Server Integration

```typescript
// kickjs-dev-server plugin
configureServer(viteDevServer) {
  return () => {
    viteDevServer.middlewares.use(async (req, res, next) => {
      // Load fresh app build via Vite's SSR module system
      let { createApp } = await viteDevServer.ssrLoadModule("virtual:kickjs/server-entry");
      let app = await createApp();
      // Delegate to Express
      app.handle(req, res, next);
    });
  };
}
```

### 7.6 Comparison: Current KickJS vs Proposed Vite Plugin

| Aspect | Current (`kick dev`) | Proposed Vite Plugin |
|---|---|---|
| Dev server | CLI spawns Vite + imports entry | Plugin installs middleware on Vite's server |
| Module discovery | Runtime decorator reflection | Build-time AST scanning + virtual modules |
| HMR | `import.meta.hot.accept()` in bootstrap | Plugin-managed with selective invalidation |
| DI reset | `Container._onReset()` replays ALL decorators | Targeted invalidation of changed + dependents only |
| Config reload | Watches `kick.config.ts`, restarts | Same behavior via plugin |
| Build | `vite build --ssr` | Plugin configures SSR environment |

---

## 8. React Router Build System Deep Dive (tsup)

### 8.1 Build Orchestration

React Router uses **pnpm workspaces** + **wireit** (no Turbo):

```bash
# Root package.json
"build": "pnpm run --filter='./packages/**/*' build"
"watch": "pnpm build && pnpm run --filter='./packages/**/*' --parallel build --watch"
"typegen": "pnpm run --recursive --parallel typegen"
```

Each package uses **wireit** in `package.json` to declare build inputs/outputs and dependencies:
```json
"wireit": {
  "build": {
    "command": "premove dist && tsup",
    "files": ["../../pnpm-workspace.yaml", "lib/**", "*.ts", "tsconfig.json", "package.json"],
    "output": ["dist/**"]
  }
}
```

Wireit handles incremental builds: if inputs haven't changed, the build is skipped entirely.

### 8.2 tsup as the Build Tool

Every package uses **tsup** (esbuild-based bundler) instead of raw Vite or Rollup:

```typescript
// Typical tsup.config.ts (e.g., react-router-serve)
export default defineConfig([{
  clean: true,
  entry: ["cli.ts"],
  format: ["cjs"],
  outDir: "dist",
  dts: true,
  banner: { js: createBanner(pkg.name, pkg.version) },
}]);
```

**Key: tsup handles both JS bundling AND type generation via `dts: true`** - no separate `tsc` step needed.

### 8.3 Package Build Patterns

| Package | Entry Points | Format | DTS | Special Notes |
|---|---|---|---|---|
| **react-router** | 4 entries | CJS + ESM | Yes | Separate dev/prod builds |
| **react-router-dev** | 6 (`cli`, `config`, `routes`, `vite`, etc.) | CJS only | Yes | Post-build copies static files |
| **react-router-serve** | 1 (`cli.ts`) | CJS only | Yes | Simple CLI entry |
| **react-router-express** | 1 (`index.ts`) | CJS + ESM | Yes | Standard pattern |
| **react-router-node** | 1 (`index.ts`) | CJS + ESM | Yes | Standard pattern |

### 8.4 Multi-Entry Point Build (react-router-dev)

The most relevant pattern for KickJS - multiple entry points from a single tsup config:

```typescript
// tsup.config.ts
export default defineConfig([{
  entry: {
    "cli/index": "cli/index.ts",
    config: "config.ts",
    internal: "internal.ts",
    routes: "routes.ts",
    vite: "vite.ts",
    "vite/cloudflare": "vite/cloudflare.ts",
  },
  format: ["cjs"],
  outDir: "dist",
  dts: true,
  external: [/\.json$/, "./static/refresh-utils.mjs"],
}]);
```

### 8.5 Dev/Prod Build Splits

The core package generates separate development and production builds:

```typescript
function createConfig(format, env) {
  return {
    entry: { "react-router": "index.ts" },
    format: [format],
    outDir: `dist/${env}`,      // dist/development/ or dist/production/
    splitting: true,
    define: {
      __DEV__: String(env === "development"),
      REACT_ROUTER_VERSION: `"${version}"`,
    },
    dts: true,
  };
}
```

**Development vs production builds are resolved by the bundler** via conditional exports in `package.json`, not by separate import paths.

### 8.6 Conditional Exports (package.json)

```json
{
  ".": {
    "node": {
      "types": "./dist/development/index.d.ts",
      "module": "./dist/development/index.mjs",
      "default": "./dist/development/index.js"
    },
    "import": { "types": "...", "default": "..." }
  },
  "./internal": { ... }
}
```

### 8.7 Post-Build Steps

The `react-router-dev` package uses a tsup plugin to copy files that can't be bundled:

```typescript
plugins: [{
  name: "copy",
  async buildEnd() {
    // Copy files loaded at runtime by Vite (can't be bundled)
    copy("vite/static/refresh-utils.mjs", "dist/static/");
    // Copy config templates for scaffolding
    copy("config/defaults/**", "dist/config/defaults/");
  }
}]
```

### 8.8 TypeScript Config Pattern

All packages use `noEmit: true` - TypeScript is for **type checking only**, tsup handles compilation and declaration generation:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "Bundler",
    "declaration": true,
    "noEmit": true
  }
}
```

---

## 9. Runtime Type Generation (Typegen)

React Router generates TypeScript declaration files **at dev time** that provide fully typed module interfaces - all without the developer writing any type generics manually.

### 9.1 Overview

**Location:** `packages/react-router-dev/typegen/`
**Output:** `.react-router/types/` directory (gitignored, regenerated on demand)

### 9.2 How It Works

**Step 1: Parse config** - Load module config, build dependency tree

**Step 2: Extract metadata** - Parse module paths for typed parameters:
```typescript
// Route: "products/:id/:variant?"
// Generates:
type Params = { id: string; variant?: string }
```

**Step 3: Build type AST with Babel** - Constructs TypeScript declarations programmatically using Babel AST builders (not string templates)

**Step 4: Use a `GetAnnotations` generic** that infers all types from module exports:
```typescript
type Annotations = GetAnnotations<
  Info & { module: typeof import("./routes/products.$id"); matches: Matches }
>;
```

This single generic reads the module's exports and computes the correct types for everything.

### 9.3 Dev Server Integration

The Vite plugin starts typegen in watch mode during development:

```typescript
if (viteCommand === "serve") {
  typegenWatcherPromise = Typegen.watch(rootDirectory, { mode, logger });
}
```

When modules change, types are regenerated automatically.

### 9.4 Standalone CLI

```bash
react-router typegen          # One-shot generation
react-router typegen --watch  # Continuous watch mode
```

### 9.5 Applicability to KickJS

React Router generates types for routes. KickJS could generate types for the **DI container** using the same approach:

```bash
kick typegen          # One-shot
kick typegen --watch  # Dev mode (integrated into kick dev)
```

**Generated output:** `.kickjs/types/container.d.ts`

```typescript
// Auto-generated from scanning @Service, @Controller, etc.
declare module "@forinda/kickjs-core" {
  interface ContainerTokenMap {
    "UserService": import("./src/modules/users/user.service").UserService;
    "UserRepository": import("./src/modules/users/user.repository").UserRepository;
    "TaskService": import("./src/modules/tasks/task.service").TaskService;
  }

  interface Container {
    resolve<K extends keyof ContainerTokenMap>(token: K): ContainerTokenMap[K];
  }
}
```

This gives **fully typed `container.resolve()` calls** without manual type annotations.

---

## 10. KickJS Build System - Current State & Improvements

### 10.1 Current KickJS Build Pattern

KickJS uses **Turbo + Vite + tsc** (two-step):

```bash
# Per-package build script
"build": "vite build && pnpm build:types"
"build:types": "tsc -p tsconfig.build.json"
```

| Aspect | KickJS (Current) | React Router | KickJS (Proposed) |
|---|---|---|---|
| **Orchestrator** | Turbo | pnpm + wireit | pnpm + wireit |
| **Bundler** | Vite (library mode) | tsup (esbuild) | tsdown (Rolldown/Rust) |
| **Type generation** | Separate `tsc -p tsconfig.build.json` | `dts: true` in tsup (tsc) | `dts: true` in tsdown (oxc) |
| **Output format** | ESM only | CJS + ESM (dual) | **ESM only** (see below) |
| **Target** | Node 20 | ES2022 | Node 20 (auto from `engines`) |
| **Dev/Prod splits** | No | Yes (dist/development, dist/production) | Yes |
| **Incremental** | Turbo cache | wireit input/output tracking | wireit |

#### Why ESM-Only (Not Dual CJS+ESM)

React Router ships dual CJS+ESM because it's consumed by millions of unknown projects, some on legacy CJS toolchains. **KickJS does not need this:**

1. **`engines.node >= 20`** — Full ESM support, no CJS fallback needed
2. **Express 5, Zod, Pino** — All ESM-compatible deps
3. **Dual package hazard** — Same module loaded as both CJS and ESM gets two separate class identities. This **breaks `instanceof` checks and DI resolution** since `@Service`/`@Controller` decorators rely on class identity matching
4. **Double build output** — 2x disk, 2x build time for zero benefit
5. **Internal consumers** — KickJS packages are consumed by your own apps and examples, not unknown CJS projects

If external npm consumers later need CJS, it can be added per-package. Until then, ESM-only keeps builds fast and avoids the dual package hazard entirely.

**Package.json pattern:**
```json
{
  "type": "module",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    }
  }
}
```

### 10.2 Proposed Build Improvements

#### A. Unify Bundling + Type Generation (tsdown + wireit)

**Problem:** KickJS runs `vite build` then `tsc` separately - two passes over the same code, slower builds. Turbo adds a daemon process for orchestration that's overkill at this scale.

**Solution:** Replace with tsdown (Rolldown/Rust) + wireit (incremental caching). See [Section 11](#11-tsdown-the-next-gen-alternative-to-tsup) for tsdown details and [Section 12](#12-removing-turbo-pnpm--wireit) for wireit migration.

**Per-package setup:**

```typescript
// packages/core/tsdown.config.ts
import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    container: 'src/container.ts',
    decorators: 'src/decorators.ts',
    'app-module': 'src/app-module.ts',
    adapter: 'src/adapter.ts',
    logger: 'src/logger.ts',
    errors: 'src/errors.ts',
    interfaces: 'src/interfaces.ts',
    reactivity: 'src/reactivity.ts',
    path: 'src/path.ts',
  },
  format: ['esm'],       // ESM-only (no CJS)
  dts: true,              // oxc-transform with isolatedDeclarations
  platform: 'node',
  shims: true,
})
```

```json
// packages/core/package.json
{
  "type": "module",
  "scripts": { "build": "wireit" },
  "wireit": {
    "build": {
      "command": "tsdown",
      "files": ["src/**", "tsdown.config.ts", "tsconfig.json", "package.json"],
      "output": ["dist/**"]
    }
  }
}
```

**Benefits:**
- Single build step (JS + DTS in one pass)
- ~80% faster with `isolatedDeclarations` (oxc-transform, not tsc)
- wireit skips unchanged packages (file-level caching)
- No Turbo daemon, no `.turbo` directories
- ESM-only avoids dual package hazard

#### C. Development vs Production Builds

**Problem:** KickJS ships same bundle for dev and prod. No dead-code elimination for dev-only features (devtools, verbose logging, DI debug traces).

**Solution:** Follow React Router's dev/prod split:

```typescript
// tsdown.config.ts
import { defineConfig } from 'tsdown'

export default defineConfig([
  {
    entry: { index: 'src/index.ts' },
    format: ['esm'],
    outDir: 'dist/development',
    define: { __DEV__: 'true' },
    dts: true,
  },
  {
    entry: { index: 'src/index.ts' },
    format: ['esm'],
    outDir: 'dist/production',
    define: { __DEV__: 'false' },
  },
])
```

Then in package.json exports:
```json
{
  ".": {
    "development": { "import": "./dist/development/index.js", "types": "./dist/development/index.d.ts" },
    "default": { "import": "./dist/production/index.js", "types": "./dist/development/index.d.ts" }
  }
}
```

This lets devtools, verbose logging, and DI debug traces be tree-shaken in production.

### 10.3 HMR Improvement: Selective Invalidation

**Current problem:** `Container._onReset()` replays ALL decorator registrations on every file change.

**Proposed:** Only re-register changed modules + their dependents:

```typescript
// In the kickjs-hmr Vite plugin
handleHotUpdate({ file, server }) {
  const changedToken = getTokenForFile(file); // e.g., "UserService"
  if (!changedToken) return;

  // 1. Find dependents in the DI graph
  const affected = container.getDependentsOf(changedToken);
  // affected = ["UserController", "UserModule"] (things that inject UserService)

  // 2. Invalidate only affected bindings
  for (const token of [changedToken, ...affected]) {
    container.invalidate(token);
  }

  // 3. Re-register the changed class (new module loaded by Vite)
  container.reRegister(changedToken, newExports[changedToken]);

  // 4. Re-resolve affected singletons
  for (const token of affected) {
    if (container.getScope(token) === Scope.SINGLETON) {
      container.resolve(token); // Triggers re-instantiation with new dep
    }
  }
}
```

**Requires adding to Container:**
```typescript
class Container {
  // Track which tokens depend on which other tokens
  private dependencyGraph: Map<string, Set<string>> = new Map();

  getDependentsOf(token: string): string[] { /* reverse graph walk */ }
  invalidate(token: string): void { /* clear cached instance */ }
  reRegister(token: string, target: any): void { /* replace binding */ }
}
```

**Expected improvement:** ~50ms targeted invalidation vs ~200ms full replay.

---

## 11. tsdown: The Next-Gen Alternative to tsup

While React Router uses **tsup** (esbuild-based), KickJS should consider **tsdown** - a newer library bundler built on **Rolldown** (Rust-based, same engine powering Vite's future bundler). tsdown is essentially "the next tsup" with better performance and tighter Vite ecosystem alignment.

### 11.1 What is tsdown?

- **Built on Rolldown** - Rust-based bundling engine (same team behind Vite/Rollup)
- **Library-focused** - Designed specifically for building npm packages
- **Sensible defaults** - Auto-reads `engines.node` from package.json for target
- **DTS built-in** - Uses `rolldown-plugin-dts` internally (not tsc)
- **Plugin ecosystem** - Supports Rolldown plugins, Unplugin, and most Rollup plugins
- **Output formats** - ESM, CJS, IIFE, UMD
- **Node.js 20.19+** required

### 11.2 tsdown vs tsup

| Feature | tsup (esbuild) | tsdown (Rolldown/Rust) |
|---|---|---|
| **Bundler engine** | esbuild (Go) | Rolldown (Rust) |
| **DTS generation** | tsc under the hood (slow) | `rolldown-plugin-dts` + oxc-transform (fast) |
| **With `isolatedDeclarations`** | Still uses tsc | Uses oxc-transform ("extremely fast") |
| **Plugin system** | esbuild plugins | Rolldown + Rollup + Unplugin (larger ecosystem) |
| **Vite alignment** | Separate tool | Same engine as Vite's future bundler |
| **Auto target from package.json** | No | Yes (`engines.node` auto-detected) |
| **CJS/ESM shims** | Manual | Auto (`__dirname`/`__filename` in ESM, `import.meta` in CJS) |
| **Glob entry patterns** | No | Yes (`src/**/*.ts`, negation patterns) |
| **Tree shaking** | esbuild tree shaking | Rolldown tree shaking (more aggressive) |
| **Config reuse** | No | `--from-vite` / `--from-vite vitest` (experimental) |
| **Maturity** | Stable, widely used | v0.21.x (beta, but production-viable for libraries) |

### 11.3 tsdown Configuration for KickJS

**Installation:**
```bash
pnpm add -D tsdown
```

**Config file:** `tsdown.config.ts`

```typescript
import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    container: 'src/container.ts',
    decorators: 'src/decorators.ts',
    'app-module': 'src/app-module.ts',
    adapter: 'src/adapter.ts',
    logger: 'src/logger.ts',
    errors: 'src/errors.ts',
    interfaces: 'src/interfaces.ts',
    reactivity: 'src/reactivity.ts',
    path: 'src/path.ts',
  },
  format: ['esm'],
  dts: true,              // Auto-generates .d.ts via rolldown-plugin-dts
  platform: 'node',       // Auto-resolves node: built-ins
  // target auto-read from package.json engines.node
  sourcemap: false,
  shims: true,            // Auto __dirname/__filename in ESM
})
```

**Glob entry patterns (unique to tsdown):**
```typescript
export default defineConfig({
  entry: ['src/*.ts', '!src/*.test.ts'],  // All .ts except tests
  format: ['esm'],
  dts: true,
  platform: 'node',
})
```

### 11.4 Dev/Prod Split with tsdown

```typescript
import { defineConfig } from 'tsdown'

export default defineConfig([
  {
    entry: { index: 'src/index.ts' },
    format: ['esm'],
    outDir: 'dist/development',
    define: { __DEV__: 'true' },
    dts: true,
  },
  {
    entry: { index: 'src/index.ts' },
    format: ['esm'],
    outDir: 'dist/production',
    define: { __DEV__: 'false' },
    // tsdown supports minification
  },
])
```

### 11.5 DTS Generation Performance

tsdown's DTS is significantly faster than tsup's:

| Approach | Engine | Speed |
|---|---|---|
| tsup `dts: true` | TypeScript compiler (tsc) | Slow (~3-5s per package) |
| tsdown `dts: true` (without `isolatedDeclarations`) | TypeScript compiler | Similar to tsup |
| tsdown `dts: true` (with `isolatedDeclarations`) | **oxc-transform (Rust)** | **Extremely fast** (~200ms) |

To unlock maximum DTS speed, add to `tsconfig.json`:
```json
{
  "compilerOptions": {
    "isolatedDeclarations": true
  }
}
```

This requires explicit return types on exported functions - a minor discipline that pays off with near-instant type generation.

### 11.6 Decorator Support

tsdown supports **Stage 2 (legacy) decorators** via `experimentalDecorators: true` in tsconfig.json - which is exactly what KickJS uses for `@Service`, `@Controller`, `@Inject`, etc.

**Note:** Stage 3 decorators are not yet supported by Rolldown/Oxc, but KickJS uses Stage 2 anyway.

### 11.7 Shims (CJS/ESM Interop)

tsdown auto-generates compatibility shims:

- **ESM output**: Auto-provides `__dirname`, `__filename` (from `import.meta.url`)
- **CJS output**: Auto-provides `import.meta.url`, `import.meta.dirname`, `import.meta.filename`
- **require() in ESM**: Auto-injects `createRequire` shim when targeting Node.js

This eliminates a whole class of CJS/ESM interop issues that KickJS users hit.

### 11.8 Migration Path (Vite lib mode -> tsdown)

Per KickJS package:

1. Install: `pnpm add -D tsdown`
2. Create `tsdown.config.ts` (copy entry points from `vite.config.ts`)
3. Update `package.json`:
   ```json
   {
     "scripts": {
       "build": "tsdown"
     }
   }
   ```
4. Delete: `vite.config.ts` (for library builds), `tsconfig.build.json`
5. Optionally add `isolatedDeclarations: true` to tsconfig for fast DTS

**Note:** Vite is still used for the **dev server** (`kick dev`) and **app builds** (examples). tsdown replaces Vite only for **library package builds**.

### 11.9 Why tsdown over tsup for KickJS

1. **Same Rust ecosystem as Vite** - Rolldown is Vite's future bundler; aligning KickJS's build with the same engine means fewer surprises
2. **Faster DTS with `isolatedDeclarations`** - oxc-transform is orders of magnitude faster than tsc for type generation
3. **Auto target from `engines.node`** - No need to manually specify `target: 'node20'`
4. **Glob entries** - `entry: ['src/*.ts', '!src/*.test.ts']` eliminates manual entry point listing
5. **Built-in shims** - No more `__dirname` issues in ESM output
6. **Plugin compatibility** - Supports Rolldown, Rollup, AND Unplugin ecosystems
7. **Config reuse** - `--from-vite` can read resolve/plugin config from existing vite.config.ts (experimental)

### 11.10 Risk Assessment

| Concern | Assessment |
|---|---|
| **Beta status (v0.21.x)** | Low risk for library builds; output is standard ESM/CJS |
| **Stage 2 decorators** | Supported via `experimentalDecorators` in tsconfig |
| **reflect-metadata** | Works fine - it's a runtime import, not a build transform |
| **Rolldown stability** | Backed by Evan You / Vite team, actively developed |
| **Fallback plan** | Can always switch to tsup - config shape is nearly identical |

---

## 12. Removing Turbo: pnpm + wireit

### 12.1 Why Remove Turbo

Turbo currently provides three things for KickJS:
1. `^build` topological ordering (core before http before cli)
2. Output caching (skip builds if inputs unchanged)
3. Parallel task execution

**All three are replaceable:**
- pnpm `-r` already runs in topological order based on workspace `dependencies`
- wireit provides per-package input/output caching (same as React Router uses)
- pnpm `--parallel` handles concurrent execution

With tsdown builds taking ~1s per package, a global build daemon is overkill for 18 packages.

### 12.2 wireit: Per-Package Incremental Builds

wireit (by Google) tracks file inputs and outputs per-package. If inputs haven't changed since last build, the step is skipped entirely. This is exactly what React Router uses.

**Install:**
```bash
pnpm add -D wireit -w
```

### 12.3 Per-Package Configuration

Each package's `package.json` gets a `wireit` section:

**packages/core/package.json:**
```json
{
  "scripts": {
    "build": "wireit",
    "test": "vitest run",
    "typecheck": "tsc --noEmit",
    "clean": "rm -rf dist"
  },
  "wireit": {
    "build": {
      "command": "tsdown",
      "files": ["src/**/*.ts", "tsdown.config.ts", "tsconfig.json", "package.json"],
      "output": ["dist/**"]
    }
  }
}
```

**packages/http/package.json** (depends on core):
```json
{
  "scripts": {
    "build": "wireit"
  },
  "wireit": {
    "build": {
      "command": "tsdown",
      "files": ["src/**/*.ts", "tsdown.config.ts", "tsconfig.json", "package.json"],
      "output": ["dist/**"],
      "dependencies": ["../core:build"]
    }
  }
}
```

**packages/cli/package.json** (depends on core + http):
```json
{
  "wireit": {
    "build": {
      "command": "tsdown",
      "files": ["src/**/*.ts", "tsdown.config.ts", "tsconfig.json", "package.json"],
      "output": ["dist/**"],
      "dependencies": ["../core:build", "../http:build"]
    }
  }
}
```

wireit handles the dependency graph — if core hasn't changed, it skips core's build AND skips http's build (since its dependency output is unchanged).

### 12.4 Root package.json (After Migration)

```json
{
  "scripts": {
    "build": "pnpm -r --filter './packages/*' run build",
    "build:examples": "pnpm -r --filter './examples/*' run build",
    "build:all": "pnpm -r run build",
    "dev": "pnpm -r --parallel --filter './packages/*' run dev",
    "test": "pnpm -r --filter './packages/*' run test",
    "test:integration": "vitest run tests/",
    "test:all": "pnpm -r --filter './packages/*' run test && vitest run tests/",
    "test:watch": "pnpm -r --parallel run test:watch",
    "typecheck": "pnpm -r run typecheck",
    "lint": "pnpm -r run lint",
    "clean": "pnpm -r run clean",
    "format": "prettier --write \"packages/*/src/**/*.ts\"",
    "format:check": "prettier --check \"packages/*/src/**/*.ts\""
  }
}
```

### 12.5 Dependency Graph (wireit)

```
  KickJS Package Build Order (wireit dependencies)
  ==================================================

  Level 0 (no deps):     Level 1:              Level 2:           Level 3:
  ================       ========              ========           ========

  core ──────────────┬──> http ─────────────┬──> cli              kickjs
  config ────────────┤                      ├──> swagger          (re-exports
                     ├──> auth              ├──> graphql           all packages)
                     ├──> ws               ├──> testing
                     ├──> queue            ├──> devtools
                     ├──> cron             ├──> otel
                     ├──> mailer
                     ├──> prisma
                     ├──> drizzle
                     ├──> multi-tenant
                     └──> notifications


  wireit caching behavior:
  ========================

  $ pnpm -r run build          # First run: builds all (~18s)
  $ pnpm -r run build          # Second run: all cached (~0.5s)
  $ touch packages/core/src/container.ts
  $ pnpm -r run build          # Rebuilds: core + all dependents
                                # Skips: config, prisma, drizzle (unchanged)
```

### 12.6 What Gets Removed

```
  REMOVE                              REPLACE WITH
  ======                              ============

  turbo.json                          wireit sections in each package.json
  "turbo" devDependency               "wireit" devDependency
  .turbo/ cache directories           .wireit/ cache directories
  "rm -rf .turbo" in clean scripts    "rm -rf .wireit" in clean scripts

  Root scripts:
    "turbo run build --filter=..."    "pnpm -r --filter '...' run build"
    "turbo run test"                  "pnpm -r run test"
    "turbo run dev --concurrency 20"  "pnpm -r --parallel run dev"
```

### 12.7 Migration Checklist

```
  Step   Action                                         Files Changed
  ====   ======                                         =============
  1      pnpm add -D wireit -w                          root package.json
  2      Add wireit config to each package               18x packages/*/package.json
  3      Replace root scripts (turbo -> pnpm -r)         root package.json
  4      Delete turbo.json                               turbo.json
  5      Remove turbo devDependency                      root package.json
  6      Update clean scripts (.turbo -> .wireit)         18x packages/*/package.json
  7      Add .wireit to .gitignore                       .gitignore
  8      Test: pnpm -r run build                         (verify)
  9      Test: touch core file, rebuild                  (verify incremental)
```

### 12.8 wireit vs Turbo Comparison

| Feature | Turbo | wireit |
|---|---|---|
| **Dependency ordering** | `^build` in turbo.json | `dependencies` per package |
| **Caching** | Global daemon, remote cache | Per-package file hashing |
| **Config location** | Single turbo.json | Each package.json (colocated) |
| **Install size** | ~20MB (Rust binary) | ~200KB (pure Node.js) |
| **Remote cache** | Yes (Vercel) | No (local only) |
| **Overhead** | Daemon process | None (runs inline) |
| **Granularity** | Task-level | File-level input/output tracking |
| **Used by** | Next.js, Turborepo users | React Router, Lit, Google projects |

For KickJS's scale (18 packages, ~1s builds), wireit's lightweight file-level caching is more than sufficient. Remote caching (Turbo's main advantage) isn't needed for a project of this size.

---

## 13. Diagrams

### 13.1 Server-Side HMR Flow (What React Router Does)

```
  Server-Side Module Hot Reload
  ==============================

  Developer saves file (e.g., user.service.ts)
         |
         v
  +------------------+
  | Vite File Watcher|
  +--------+---------+
           |
           v
  +------------------------+
  | handleHotUpdate() hook |
  | in Vite plugin         |
  +--------+---------------+
           |
           v
  +------------------------+
  | Child Compiler         |
  |  - compileFile()       |
  |  - Extract exports     |
  |    (loader, action,    |
  |     middleware, etc)   |
  +--------+---------------+
           |
           v
  +---------------------------+
  | Compare Old vs New        |
  | Module Metadata            |
  |  - hasLoader changed?     |
  |  - hasAction changed?     |
  |  - hasMiddleware changed? |
  +--------+------------------+
           |
     +-----+------+
     |             |
   Changed     Unchanged
     |             |
     v             v
  +------------------+    +--------------------+
  | Invalidate       |    | Module already     |
  | Virtual Modules  |    | invalidated in     |
  | (server-build,   |    | Vite's SSR graph   |
  |  manifests)      |    | (standard Vite HMR)|
  +--------+---------+    +--------------------+
           |
           v
  +---------------------------+
  | Next request triggers     |
  | ssrLoadModule() /         |
  | runner.import()           |
  |  -> Re-evaluates module   |
  |  -> Fresh server code     |
  |  -> No process restart    |
  +---------------------------+
```

### 13.2 Virtual Module Architecture

```
                    Virtual Module Architecture
                    ===========================

  +-------------------+     resolveId()      +---------------------------+
  | import "virtual:  | ------------------> | Plugin resolves to        |
  |  kickjs/          |                     | \0virtual:kickjs/         |
  |  server-entry"    |                     |  server-entry             |
  +-------------------+                     +-------------+-------------+
                                                          |
                                                    load() hook
                                                          |
                                                          v
                                            +----------------------------+
                                            | Generated Code:            |
                                            |                            |
                                            | import { UserModule }      |
                                            |   from "./modules/users"   |
                                            | import { TaskModule }      |
                                            |   from "./modules/tasks"   |
                                            |                            |
                                            | export const modules = [   |
                                            |   UserModule, TaskModule   |
                                            | ];                         |
                                            +----------------------------+

  On config/decorator change:
  +------------------+     invalidateModule()     +------------------+
  | File Watcher /   | ------------------------> | moduleGraph      |
  | transform() hook |                           | .invalidateModule|
  +------------------+                           | (virtualModule)  |
                                                  +--------+---------+
                                                           |
                                                    Next import()
                                                    re-runs load()
                                                           |
                                                           v
                                                  +------------------+
                                                  | Fresh generated  |
                                                  | code with new    |
                                                  | module registry  |
                                                  +------------------+
```

### 13.3 KickJS Current DI + HMR Flow

```
              Current KickJS DI + HMR Architecture
              =====================================

  APP STARTUP
  ===========
                                    Module Load Time
  +------------------+              (before Container exists)
  | @Service()       |  ----+
  | @Controller()    |      |   +---------------------------+
  | @Injectable()    |      +-> | pendingRegistrations[]    |
  | @Repository()    |      |   | (queued decorator calls)  |
  +------------------+      |   +-------------+-------------+
  | @Autowired()     |  ----+                 |
  | @Inject()        |                        |
  | @Value()         |            Container.getInstance()
  | @PostConstruct() |                        |
  +------------------+                        v
                              +-------------------------------+
                              | Container._onReady()          |
                              |  - Flush pending registrations|
                              |  - resolve() dependencies     |
                              |  - Call @PostConstruct hooks  |
                              +-------------------------------+
                                              |
                                              v
                              +-------------------------------+
                              | bootstrap()                   |
                              |  - Register modules           |
                              |  - Mount routes               |
                              |  - Start Express server       |
                              |  - Store app in globalThis    |
                              +-------------------------------+


  HMR (File Change)
  =================

  Developer saves file
         |
         v
  +------------------+
  | Vite detects     |
  | module change    |
  +--------+---------+
           |
           v
  +----------------------------+
  | import.meta.hot.accept()   |
  | in bootstrap()             |
  +--------+-------------------+
           |
           v
  +----------------------------+     Preserved across HMR:
  | Container._onReset()       |     +---------------------+
  |  - Clear ALL bindings      |     | globalThis.__app    |
  |  - Replay allRegistrations |     |  - Express instance |
  |    Map (ALL decorators)    |     |  - HTTP server      |
  |  - Name-based fallback     |     |  - DB connections   |
  |    (__hmr__ClassName)       |     |  - Redis clients    |
  +--------+-------------------+     +---------------------+
           |
           v
  +----------------------------+
  | app.rebuild()              |
  |  - Re-register modules     |
  |  - Re-mount routes         |
  |  - Swap Express handler    |
  |  - NO server restart       |
  +----------------------------+
```

### 13.4 Proposed KickJS Vite Plugin Architecture

```
          Proposed KickJS Vite Plugin Architecture
          =========================================

  kickjsVitePlugin(options)
         |
         |  Returns Plugin[]
         v
  +--------------------------------------------------------------+
  |                                                              |
  |  +--------------------+  +------------------------+          |
  |  | kickjs-core        |  | kickjs-virtual-modules |          |
  |  | - config()         |  | - resolveId()          |          |
  |  | - configResolved() |  | - load()               |          |
  |  |                    |  |                        |          |
  |  +--------------------+  | Virtual Modules:       |          |
  |                          | - virtual:kickjs/       |          |
  |  +--------------------+  |   server-entry         |          |
  |  | kickjs-module-     |  | - virtual:kickjs/      |          |
  |  | discovery          |  |   container-registry   |          |
  |  | - transform()      |  | - virtual:kickjs/      |          |
  |  |   (AST scan for    |  |   app-modules          |          |
  |  |    decorators)     |  +------------------------+          |
  |  +--------------------+                                      |
  |                          +------------------------+          |
  |  +--------------------+  | kickjs-dev-server      |          |
  |  | kickjs-hmr         |  | - configureServer()    |          |
  |  | - handleHotUpdate()|  |   (Express middleware   |          |
  |  | - Selective DI     |  |    on Vite's server)   |          |
  |  |   invalidation     |  |                        |          |
  |  | - kickjs:module-   |  | - Fresh module load    |          |
  |  |   update event     |  |   per request via      |          |
  |  +--------------------+  |   ssrLoadModule()      |          |
  |                          +------------------------+          |
  +--------------------------------------------------------------+


  HMR Flow with Plugin:
  =====================

  File Change (e.g., user.service.ts)
       |
       v
  +-------------------------+
  | kickjs-module-discovery |
  | transform() detects     |
  | @Service decorator      |
  +--------+----------------+
           |
           v
  +-------------------------+
  | kickjs-hmr              |
  | handleHotUpdate()       |
  +--------+----------------+
           |
     +-----+------+
     |             |
  @Service    kick.config.ts
  @Controller    change
     |             |
     v             v
  +------------------+  +-------------+
  | Selective DI     |  | Full server |
  | invalidation:    |  | restart     |
  | - UserService    |  +-------------+
  | - UserController |
  | - UserModule     |
  | (dependents only)|
  +--------+---------+
           |
           v
  +-----------------------------+
  | Invalidate virtual:kickjs/  |
  | container-registry          |
  +--------+--------------------+
           |
           v
  +-----------------------------+
  | Re-resolve affected         |
  | singletons only             |
  | app.patchRoutes(affected)   |
  +-----------------------------+
```

### 13.5 Selective HMR vs Full Reset

```
  Current KickJS HMR                        Proposed Selective HMR
  ===================                        ======================

  File: user.service.ts changed              File: user.service.ts changed
       |                                          |
       v                                          v
  Container._onReset()                       Plugin: getTokenForFile(file)
       |                                     => "UserService"
       v                                          |
  Clear ALL bindings                              v
  (UserService, TaskService,                 container.getDependentsOf("UserService")
   AuthService, MailerService,               => ["UserController", "UserModule"]
   LoggerService, CacheService,                   |
   QueueService, CronService,                     v
   ... 30+ services)                         Invalidate ONLY:
       |                                     - UserService (changed)
       v                                     - UserController (depends on it)
  Replay ALL 30+ decorator                   - UserModule (depends on it)
  registrations                                   |
       |                                          v
       v                                     Re-register UserService
  Re-resolve ALL singletons                  with new class from Vite
       |                                          |
       v                                          v
  Call ALL @PostConstruct hooks              Re-resolve only affected
       |                                     singletons (3 instead of 30+)
       v                                          |
  app.rebuild()                                   v
  (full route re-mount)                      app.patchRoutes(affected)
       |                                     (targeted route update)
       v                                          |
  ~200ms total                                    v
                                             ~50ms total


  Dependency Graph Tracking (new Container capability):
  =====================================================

  UserRepository ──> UserService ──> UserController
                          |                |
                          v                v
                     UserModule ──> Express Router /users/*

  When UserService changes:
  - Walk reverse graph: UserController, UserModule
  - Skip: TaskService, AuthService, etc. (unrelated)
  - Result: 3 invalidations instead of 30+
```

### 13.6 Build System Comparison

```
  Build System: KickJS (Current) vs React Router vs Proposed
  ===========================================================

  KickJS CURRENT                    React Router                   KickJS PROPOSED
  ==============                    ============                   ===============

  turbo build                       pnpm --filter build            pnpm -r run build
       |                                 |                              |
       v                                 v                              v
  +-----------+                    +-----------+                   +-----------+
  | vite build|                    | wireit    |                   | wireit    |
  | (lib mode)|                    | (input/   |                   | (input/   |
  +-----------+                    |  output   |                   |  output   |
       |                           |  cache)   |                   |  cache)   |
       v                           +-----------+                   +-----------+
  +-----------+                         |                              |
  | tsc       |                         v                              v
  | (types    |                    +-----------+                   +------------+
  |  only)    |                    | tsup      |                   | tsdown     |
  +-----------+                    | (esbuild  |                   | (Rolldown/ |
       |                           |  JS+DTS)  |                   |  Rust,     |
       |                           +-----------+                   |  oxc DTS)  |
  2 steps                               |                         +------------+
       |                                 |                              |
       v                                 v                         1 step
  dist/                            dist/                                |
    index.js                         development/                       v
    index.d.ts                         index.js                    dist/
                                       index.d.ts                   development/
                                     production/                      index.js
                                       index.js                       index.d.ts
                                                                    production/
                                                                      index.js


  Time comparison (estimated per package):
  =========================================

  KickJS Current:   vite build (~2s) + tsc (~3s)           = ~5s per package
  React Router:     tsup (~2s, JS + tsc DTS)               = ~2s per package
  KickJS Proposed:  tsdown (~1s, JS + oxc DTS)             = ~1s per package
                    (with isolatedDeclarations)               (~80% faster)
```

### 13.7 Typegen Flow (React Router vs Proposed KickJS)

```
  React Router Typegen                     KickJS Typegen (Proposed)
  ========================                 ==========================

  routes.ts changes                        @Service/@Controller file changes
       |                                        |
       v                                        v
  ConfigLoader detects                     Vite transform() hook
  route config change                      detects decorator via AST
       |                                        |
       v                                        v
  Parse route paths                        Extract token name, deps,
  (:id, :slug?)                            constructor params
       |                                        |
       v                                        v
  Build Babel AST for                      Build ContainerTokenMap
  type declarations                        type declaration
       |                                        |
       v                                        v
  Write .react-router/types/               Write .kickjs/types/
  +types/product.ts:                       container.d.ts:

  export namespace Route {                 interface ContainerTokenMap {
    type LoaderArgs = {                      UserService: UserService;
      params: { id: string }                 TaskService: TaskService;
    }                                        UserRepo: UserRepository;
  }                                        }

                                           interface Container {
  Imported as:                               resolve<K extends keyof
  import { Route }                             ContainerTokenMap>(
    from "./+types/product"                    token: K
                                             ): ContainerTokenMap[K];
                                           }

                                           Result:
                                           container.resolve("UserService")
                                           // => UserService (fully typed!)
```

### 13.8 HMR + DI Reset Sequence Diagram

```
  Server-Side HMR + DI Container Sequence
  =========================================

  Time
  |
  |  Developer          Vite           KickJS Plugin    Container        Express
  |  =========          ====           =============    =========        =======
  |
  |  Save file -------> Detect
  |                     change
  |                       |
  |                       +-----------> handleHotUpdate()
  |                                          |
  |                                    Is decorated class?
  |                                      (AST check)
  |                                          |
  |                                     Yes  |
  |                                          |
  |                                    getTokenForFile()
  |                                    getDependentsOf()
  |                                          |
  |                                    Invalidate virtual
  |                                    modules
  |                                          |
  |                       <-----------------+
  |                     SSR module
  |                     re-evaluated
  |                       |
  |                       +------------------------------------> invalidate(token)
  |                                                              invalidate(dependents)
  |                                                                |
  |                                                          Re-register changed
  |                                                          class only
  |                                                                |
  |                                                          Re-resolve affected
  |                                                          singletons only
  |                                                                |
  |                                                          Call @PostConstruct
  |                                                          on changed instances
  |                                                                |
  |                                                                +-------> patchRoutes()
  |                                                                            |
  |                                                                       Update affected
  |                                                                       routes only
  |                                                                       (same HTTP server,
  |                                                                        same port,
  |                                                                        same connections)
  |                                                                            |
  |  <~~ Next request uses new code ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~+
  |
  v
```

### 13.9 Build Optimization Summary

```
  Improvement Areas & Expected Impact
  =====================================

  1. TSDOWN + WIREIT (Build Speed)
     ┌──────────────────────────────────────────────┐
     │ Before: turbo + vite build + tsc = ~5s/pkg   │
     │ After:  wireit + tsdown (oxc DTS) = ~1s/pkg  │
     │         (with isolatedDeclarations)           │
     │ Impact: ~80% faster, no Turbo daemon          │
     │ 18 packages: ~90s -> ~18s total               │
     │ Incremental: wireit skips unchanged packages  │
     └──────────────────────────────────────────────┘

  2. DEV/PROD SPLITS (Bundle Quality)
     ┌─────────────────────────────────────────────┐
     │ Before: Single bundle, __DEV__ not stripped  │
     │ After:  dist/development/ + dist/production/ │
     │ Impact: Smaller prod bundles,                │
     │         tree-shaken devtools/debug logs       │
     └─────────────────────────────────────────────┘

  3. SELECTIVE HMR (Dev Experience)
     ┌─────────────────────────────────────────────┐
     │ Before: Full container reset (~200ms)        │
     │ After:  Targeted invalidation (~50ms)        │
     │ Impact: 4x faster hot reload feedback        │
     └─────────────────────────────────────────────┘

  4. TYPEGEN (Developer Ergonomics)
     ┌─────────────────────────────────────────────┐
     │ Before: container.resolve("UserService")     │
     │         returns `any` (no type safety)       │
     │ After:  Fully typed resolve() via generated  │
     │         ContainerTokenMap                    │
     │ Impact: Catch DI errors at compile time      │
     └─────────────────────────────────────────────┘

  5. VIRTUAL MODULES (Auto-Discovery)
     ┌─────────────────────────────────────────────┐
     │ Before: Manual imports in module files       │
     │ After:  Vite transform auto-discovers        │
     │         @Service/@Controller decorators       │
     │ Impact: Zero boilerplate for new services    │
     └─────────────────────────────────────────────┘

  6. VITE PLUGIN (Framework Integration)
     ┌─────────────────────────────────────────────┐
     │ Before: CLI wraps Vite externally            │
     │ After:  @forinda/kickjs-vite plugin gives    │
     │         first-class Vite integration          │
     │ Impact: Users can use kickjs in any Vite     │
     │         project, not just CLI-scaffolded ones │
     └─────────────────────────────────────────────┘
```

---

## 13. Current Rebuild/HMR Issues Found

Audit of the current KickJS HMR rebuild system (`packages/http/src/bootstrap.ts`, `application.ts`, `packages/core/src/container.ts`, `decorators.ts`).

### 13.1 Critical Issues

#### A. `@PostConstruct` errors are uncaught during HMR

**File:** `packages/core/src/container.ts` (createInstance)

```typescript
const postConstruct = Reflect.getMetadata(METADATA.POST_CONSTRUCT, reg.target.prototype)
if (postConstruct && typeof instance[postConstruct] === 'function') {
  instance[postConstruct]()  // No try/catch - if this throws, rebuild is broken
}
```

If `@PostConstruct` throws during rebuild, the container is left partially initialized. The HTTP server is still connected to the old Express app. No recovery.

**Fix:** Wrap in try/catch, log error, and either skip the service or roll back the rebuild.

#### B. DB/Redis connections are NOT preserved across HMR

**File:** `packages/http/src/application.ts` (rebuild)

```typescript
rebuild(): void {
  Container.reset()  // ← All singletons discarded, including DB connections
  this.container = Container.getInstance()
  this.app = express()
  this.setup()
}
```

`Container.reset()` creates a **completely new container**. Any manually registered instances (DB pool, Redis client, Prisma client) are lost. Only `@Service`/`@Controller` decorated classes are replayed via `allRegistrations`.

**Fix:** Add a preservation API:
```typescript
Container.reset({ preserve: [DB_TOKEN, REDIS_TOKEN] })
// or
container.markPersistent(DB_TOKEN)
```

#### C. Async `@PostConstruct` is silently broken

```typescript
@Service()
class CacheService {
  @PostConstruct()
  async warmCache() {
    this.data = await redis.hgetall('cache')  // Never awaited!
  }
}
```

`bootstrap()` is synchronous. Routes are mounted immediately after `container.bootstrap()`. Any async `@PostConstruct` returns a Promise that nobody awaits. First requests hit uninitialized services.

**Fix:** Either validate that `@PostConstruct` methods are synchronous (throw at decoration time if async), or make the bootstrap lifecycle async-aware.

#### D. Non-decorator registrations lost on HMR

**File:** `packages/core/src/decorators.ts` (`_onReset` callback)

```typescript
Container._onReset = (container) => {
  for (const [target, scope] of allRegistrations) {  // Only decorated classes
    container.register(target, target, scope)
  }
}
```

`registerFactory()` and `registerInstance()` calls are NOT replayed. Any adapter that does manual registration loses its bindings.

**Fix:** Track factory/instance registrations in a separate replay list, or provide an adapter lifecycle hook: `adapter.onRebuild(ctx)`.

### 13.2 Major Issues

#### E. Memory leak in `allRegistrations`

`allRegistrations` Map never removes entries. Each HMR reload adds new class references without cleaning old ones. After hundreds of reloads, the map grows unbounded and replay walks all entries.

**Fix:** Key by class name, not class reference. When a new class with the same name is registered, replace the old entry.

#### F. Stale adapter references after rebuild

```typescript
rebuild(): void {
  this.app = express()  // New Express instance
  this.setup()          // Adapters get new ctx in beforeMount
}
```

But adapters that cached `app` or `container` references from a previous `beforeMount()` call now hold stale references. No invalidation mechanism exists.

**Fix:** Either document that adapters must not cache references, or add `adapter.onRebuild?()` / `adapter.dispose?()`.

#### G. `rebuild()` has no error recovery

```typescript
rebuild(): void {
  Container.reset()
  this.container = Container.getInstance()
  this.app = express()
  this.setup()  // If this throws, server is half-initialized
  if (this.httpServer) {
    this.httpServer.removeAllListeners('request')
    this.httpServer.on('request', this.app)
  }
}
```

If `setup()` throws (bad decorator, missing dependency), the old listeners are already removed but new ones aren't attached. The HTTP server is alive but unresponsive.

**Fix:** Build the new app fully before swapping:
```typescript
rebuild(): void {
  const newContainer = Container.reset()
  const newApp = express()
  try {
    this.setupWith(newContainer, newApp)  // Build fully
  } catch (err) {
    logger.error('HMR rebuild failed, keeping old app', err)
    return  // Keep old app running
  }
  // Only swap after success
  this.container = newContainer
  this.app = newApp
  this.httpServer.removeAllListeners('request')
  this.httpServer.on('request', this.app)
}
```

### 13.3 What Works Well

- **Persistent decorator registry** (`allRegistrations` Map) - clever pattern for surviving container reset
- **HMR name-based fallback** (`__hmr__ClassName`) - handles class identity changes across module re-evaluation
- **HTTP server preservation** (`globalThis.__app`) - Express server, port, TCP connections persist
- **Guard against double bootstrap** (`globalThis.__kickBootstrapped`) - prevents re-registering error handlers
- **Queue adapter defensive checks** (`container.has(jobClass)`) - smart pattern other adapters should copy

### 13.4 Priority Fix Order

```
  Priority   Issue                                  Effort    Impact
  ========   =====                                  ======    ======
  P0         Error recovery in rebuild()            Small     Prevents dead server
  P0         Wrap @PostConstruct in try/catch       Small     Prevents silent failures
  P1         Preserve manual registrations          Medium    DB/Redis connections survive
  P1         Validate async @PostConstruct          Small     Prevents hidden bugs
  P2         Memory leak in allRegistrations        Small     Dev session stability
  P2         Adapter stale reference warning        Small     Better DX
  P3         Async-aware bootstrap lifecycle        Large     Proper async init
```

---

## 14. Vite vs tsdown: Where Each Tool Lives

tsdown replaces Vite **only for library package builds**. Vite remains for the dev server and app builds.

```
  Tool Responsibilities After Migration
  =======================================

  TSDOWN (library builds)              VITE (dev server + app builds)
  ========================             ==============================

  packages/core/                       kick dev
    tsdown.config.ts                     CLI starts Vite dev server
    -> dist/index.js + .d.ts             RunnableDevEnvironment
                                         ssrLoadModule() for HMR
  packages/http/                         import.meta.hot.accept()
    tsdown.config.ts
    -> dist/index.js + .d.ts           kick build (app builds)
                                         vite build --ssr
  packages/cli/                          (user's app entry point)
    tsdown.config.ts
    -> dist/cli.js + .d.ts             examples/minimal-api/
                                         vite.config.ts (app build)
  packages/config/
    tsdown.config.ts                   @forinda/kickjs-vite (proposed)
    -> dist/index.js + .d.ts             Vite plugin for user apps
                                         configureServer() hook
  packages/auth/                         virtual modules
    tsdown.config.ts                     HMR handling
    -> dist/index.js + .d.ts

  ... (all 18 library packages)


  What gets REMOVED per package:       What STAYS:
  ================================     =================
  vite.config.ts (lib build)           tsconfig.json
  tsconfig.build.json                  vitest.config.ts (tests)
                                       package.json

  What gets ADDED per package:
  ================================
  tsdown.config.ts
```

---

## 15. DevTools Improvements: Why Classes Show as "Not Instantiated"

### 15.1 Root Cause

The devtools Container tab reads `container.getRegistrations()` which checks `reg.instance !== undefined`. The problem is **most classes are never eagerly instantiated** — they're only resolved when first needed.

```typescript
// container.ts - getRegistrations()
getRegistrations() {
  return Array.from(this.registrations.entries()).map(([token, reg]) => ({
    token: tokenName(token),
    scope: reg.scope === Scope.SINGLETON ? 'singleton' : 'transient',
    instantiated: reg.instance !== undefined,  // Only true if resolve() was called
  }));
}
```

**Why classes show as "not instantiated":**

1. **Lazy singletons** — `@Service()` classes are registered on decoration but only instantiated when first `resolve()`'d. If nothing injects them yet, `instance` stays `undefined`
2. **Transient services** — `Scope.TRANSIENT` classes **never** cache their instance in `reg.instance`. They're created fresh each time, so `instantiated` is always `false` even after 1000 calls
3. **`@Autowired()` lazy getters** — Property injection uses `Object.defineProperty` with a getter that resolves on first access. Until the property is actually read, the dependency isn't instantiated
4. **Timing** — The devtools middleware runs at `beforeGlobal` phase. If you check `/_debug/container` before any requests hit controllers, most services haven't been resolved yet

### 15.2 What the Container Doesn't Track (But Should)

| Data | Currently Tracked | Needed For DevTools |
|---|---|---|
| Registration exists | Yes (`has()`) | Yes |
| Scope (singleton/transient) | Yes | Yes |
| Singleton instantiated | Yes (`reg.instance !== undefined`) | Yes |
| Transient ever instantiated | **No** | Yes |
| Transient instantiation count | **No** | Yes |
| Class type (service/controller/repo) | **Partial** (only controller via `CONTROLLER_PATH` metadata) | Yes |
| Registration method (decorator/factory/instance) | **No** | Yes |
| Instantiation timestamp | **No** | Yes |
| Dependencies (what it injects) | **No** (only in resolve chain) | Yes |
| Dependents (what injects it) | **No** | Yes |
| `@PostConstruct` status | **No** | Yes |
| Resolution time (ms) | **No** | Yes |

### 15.3 Proposed Container Enhancements

#### A. Track Class Type via Metadata

Currently decorators like `@Service`, `@Repository`, `@Component` all call the same `registerInContainer()`. They're indistinguishable in the container. Fix by storing the decorator kind:

```typescript
// In decorators.ts
export const METADATA = {
  // ... existing
  CLASS_KIND: Symbol('kick:class-kind'),  // NEW
}

// In each decorator
function Service(options?) {
  return (target) => {
    Reflect.defineMetadata(METADATA.CLASS_KIND, 'service', target)
    registerInContainer(target, options?.scope)
  }
}

function Controller(path?) {
  return (target) => {
    Reflect.defineMetadata(METADATA.CLASS_KIND, 'controller', target)
    // ...
  }
}

function Repository(options?) {
  return (target) => {
    Reflect.defineMetadata(METADATA.CLASS_KIND, 'repository', target)
    registerInContainer(target, options?.scope)
  }
}
```

#### B. Enhanced Registration Type

```typescript
interface Registration {
  target: Constructor
  scope: Scope
  instance?: any
  factory?: () => any
  // NEW fields:
  kind: 'service' | 'controller' | 'repository' | 'component' | 'injectable' | 'factory' | 'instance'
  resolveCount: number          // How many times resolve() was called
  lastResolvedAt?: number       // Timestamp of last resolution
  firstResolvedAt?: number      // Timestamp of first resolution
  resolveDurationMs?: number    // Last resolution time
  postConstructStatus?: 'pending' | 'completed' | 'failed' | 'skipped'
  dependencies: string[]        // Tokens this class injects (from constructor params)
}
```

#### C. Enhanced `getRegistrations()` API

```typescript
getRegistrations(): RegistrationInfo[] {
  return Array.from(this.registrations.entries()).map(([token, reg]) => ({
    token: tokenName(token),
    scope: reg.scope === Scope.SINGLETON ? 'singleton' : 'transient',
    kind: reg.kind,
    instantiated: reg.scope === Scope.SINGLETON
      ? reg.instance !== undefined
      : reg.resolveCount > 0,           // Transients: check if ever resolved
    resolveCount: reg.resolveCount,
    lastResolvedAt: reg.lastResolvedAt,
    firstResolvedAt: reg.firstResolvedAt,
    resolveDurationMs: reg.resolveDurationMs,
    postConstructStatus: reg.postConstructStatus,
    dependencies: reg.dependencies,
  }));
}
```

#### D. Track Resolution in `resolve()`

```typescript
resolve<T>(token: any): T {
  let reg = this.registrations.get(token);
  // ... existing fallback logic

  if (reg.scope === Scope.SINGLETON && reg.instance) {
    reg.resolveCount++;                          // NEW
    reg.lastResolvedAt = Date.now();             // NEW
    return reg.instance as T;
  }

  const start = performance.now();              // NEW
  const instance = this.createInstance(reg);
  reg.resolveDurationMs = performance.now() - start;  // NEW
  reg.resolveCount++;                           // NEW
  reg.lastResolvedAt = Date.now();              // NEW
  if (!reg.firstResolvedAt) reg.firstResolvedAt = Date.now();  // NEW

  if (reg.scope === Scope.SINGLETON) {
    reg.instance = instance;
  }

  return instance as T;
}
```

#### E. Track Dependencies at Registration Time

```typescript
// In register() or createInstance(), extract constructor params:
private extractDependencies(target: Constructor): string[] {
  const paramTypes = Reflect.getMetadata('design:paramtypes', target) || [];
  const injections = Reflect.getMetadata(METADATA.INJECT_TOKENS, target) || {};
  return paramTypes.map((type: any, index: number) => {
    return injections[index] ? tokenName(injections[index]) : tokenName(type);
  });
}
```

### 15.4 DevTools Dashboard Improvements

#### A. Enhanced Container Tab

```
  Current Container Tab               Proposed Container Tab
  =====================               ======================

  Token    | Scope     | Instantiated   Token    | Kind       | Scope     | Status     | Resolves | Deps
  ---------|-----------|-------------   ---------|------------|-----------|------------|----------|------
  UserSvc  | singleton | no             UserSvc  | service    | singleton | active     | 147      | [UserRepo]
  UserRepo | singleton | no             UserRepo | repository | singleton | active     | 147      | [PrismaClient]
  UserCtrl | singleton | no             UserCtrl | controller | singleton | active     | 0        | [UserSvc]
  TaskSvc  | singleton | no             TaskSvc  | service    | singleton | registered | 0        | [TaskRepo]
  Logger   | transient | no             Logger   | service    | transient | active     | 892      | []
                                        DbPool   | instance   | singleton | active     | 43       | []

  Status legend:
  - "registered" = never resolved (no requests hit it yet)
  - "active"     = resolved at least once
  - "failed"     = @PostConstruct threw an error
```

#### B. Dependency Graph Visualization

Add a `/_debug/graph` endpoint that returns the DI dependency graph:

```typescript
// GET /_debug/graph
{
  "nodes": [
    { "id": "UserService", "kind": "service", "scope": "singleton", "resolveCount": 147 },
    { "id": "UserRepository", "kind": "repository", "scope": "singleton", "resolveCount": 147 },
    { "id": "UserController", "kind": "controller", "scope": "singleton", "resolveCount": 0 }
  ],
  "edges": [
    { "from": "UserController", "to": "UserService" },
    { "from": "UserService", "to": "UserRepository" }
  ]
}
```

The dashboard can render this as an interactive graph using a lightweight lib (e.g., `vis-network` via CDN, or simple SVG).

#### C. Real-Time Updates via SSE

Replace polling with Server-Sent Events for live metrics:

```typescript
// In DevToolsAdapter
app.get('/_debug/stream', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  const interval = setInterval(() => {
    const data = {
      requestCount: this.requestCount.value,
      errorCount: this.errorCount.value,
      errorRate: this.errorRate.value,
      uptimeSeconds: this.uptimeSeconds.value,
    };
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  }, 1000);

  req.on('close', () => clearInterval(interval));
});
```

Or better — use the existing reactivity system's `subscribe()`:

```typescript
app.get('/_debug/stream', (req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', ... });

  const unsub = this.requestCount.subscribe((count) => {
    res.write(`event: metrics\ndata: ${JSON.stringify({ requestCount: count })}\n\n`);
  });

  req.on('close', () => unsub());
});
```

#### D. `@PostConstruct` Lifecycle Visibility

Track and expose the status of lifecycle hooks:

```typescript
// In container.ts createInstance()
try {
  const result = instance[postConstruct]();
  if (result instanceof Promise) {
    reg.postConstructStatus = 'pending';
    result
      .then(() => { reg.postConstructStatus = 'completed'; })
      .catch(() => { reg.postConstructStatus = 'failed'; });
  } else {
    reg.postConstructStatus = 'completed';
  }
} catch (err) {
  reg.postConstructStatus = 'failed';
  // log error but don't crash
}
```

#### E. Latency Percentiles

Replace min/max with percentile tracking:

```typescript
// In the request middleware
interface RouteStats {
  count: number
  totalMs: number
  samples: number[]     // Ring buffer of last N durations
  p50: number
  p95: number
  p99: number
}

// After each request
stats.samples.push(elapsed);
if (stats.samples.length > 1000) stats.samples.shift();  // Keep last 1000
stats.p50 = percentile(stats.samples, 0.50);
stats.p95 = percentile(stats.samples, 0.95);
stats.p99 = percentile(stats.samples, 0.99);
```

### 15.5 Implementation Priority

```
  Priority   Improvement                              Effort    Impact
  ========   ===========                              ======    ======
  P0         Store CLASS_KIND metadata in decorators   Small     Classes show type in devtools
  P0         Track resolveCount in resolve()           Small     Transients show as "active"
  P1         Track dependencies via paramtypes         Medium    Dependency graph endpoint
  P1         Wrap @PostConstruct with status tracking   Small     Lifecycle visibility
  P1         SSE stream endpoint (/_debug/stream)      Medium    Real-time dashboard updates
  P2         Dependency graph visualization            Medium    Interactive DI graph in UI
  P2         Latency percentiles (p50/p95/p99)         Small     Better performance insight
  P3         Resolution timing (ms per resolve)        Small     Performance profiling
  P3         Error details capture (stack traces)      Medium    Debug error spikes
```

### 15.6 Quick Win: Fix "Not Instantiated" Right Now

Without any Container changes, the devtools can improve accuracy by **triggering resolution** of all singletons on startup:

```typescript
// In DevToolsAdapter.beforeMount()
beforeMount({ container }: AdapterContext) {
  // Force-resolve all singletons so devtools shows accurate status
  const registrations = container.getRegistrations();
  for (const reg of registrations) {
    if (reg.scope === 'singleton' && !reg.instantiated) {
      try {
        container.resolve(reg.token);  // Eager instantiation
      } catch {
        // Skip if circular or missing dep
      }
    }
  }
}
```

This is a **bandaid** — it forces eager instantiation of all singletons. The real fix is tracking `resolveCount` so transient and lazy singletons show their true status.

---

## 16. Production Readiness Audit

### 16.1 Scorecard

| Area | Score | Status | Notes |
|---|---|---|---|
| Graceful Shutdown | 9/10 | Excellent | SIGTERM/SIGINT, adapter shutdown via `Promise.allSettled()`, DB disconnect |
| Configuration | 8.5/10 | Very Good | Zod env validation, `@Value()` decorator, `ConfigService` |
| Database Lifecycle | 8.5/10 | Very Good | Prisma/Drizzle adapters, proper `$disconnect()`, query adapters |
| Testing | 8.5/10 | Very Good | `createTestApp()`, container isolation, supertest integration |
| Request Validation | 8.5/10 | Very Good | Zod middleware, 422 error responses, type inference |
| Logging | 8.5/10 | Very Good | Pino structured JSON, named loggers, request ID middleware |
| Security | 8/10 | Good | Helmet-like headers, CORS, CSRF, rate limiting |
| Queue Reliability | 8/10 | Good | BullMQ, worker concurrency, graceful worker shutdown |
| OpenTelemetry | 7.5/10 | Good | HTTP spans + metrics, custom attributes, route ignore |
| Error Handling | 7/10 | Good | Global handlers, Zod/HttpException catches, 500 fallback |
| Process Management | 2/10 | **Minimal** | No clustering, no PM2 guide, no K8s probes |
| Health Checks | 1/10 | **Missing** | No built-in endpoint at all |
| **OVERALL** | **7.2/10** | **Production-viable with gaps** | |

### 16.2 Critical Gaps (Must Fix)

#### A. No Health Check Endpoint

Required by every load balancer, Kubernetes, and monitoring system. Nothing exists today.

**Fix:** Add a health check adapter or built-in routes:

```typescript
// Built-in health check (no adapter needed)
// GET /health/live   → 200 { status: "ok" }  (process alive)
// GET /health/ready  → 200/503              (deps checked)

app.get('/health/live', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

app.get('/health/ready', async (req, res) => {
  const checks = await Promise.allSettled([
    container.resolve('PrismaClient').$queryRaw`SELECT 1`,
    container.has('RedisClient') ? container.resolve('RedisClient').ping() : null,
    container.has('QueueService') ? container.resolve('QueueService').isReady() : null,
  ]);
  const healthy = checks.every(c => c.status === 'fulfilled');
  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'ready' : 'degraded',
    checks: checks.map((c, i) => ({
      name: ['database', 'redis', 'queue'][i],
      status: c.status === 'fulfilled' ? 'up' : 'down',
    })),
  });
});
```

#### B. No Request Context in Logs

Request ID exists in middleware but is NOT propagated to service/repository logs. When UserService logs an error, you can't trace it back to the request.

**Fix:** Use Node.js `AsyncLocalStorage`:

```typescript
import { AsyncLocalStorage } from 'node:async_hooks';

export const requestContext = new AsyncLocalStorage<{ requestId: string }>();

// Middleware: wrap each request
app.use((req, res, next) => {
  const requestId = req.headers['x-request-id'] || crypto.randomUUID();
  requestContext.run({ requestId }, () => next());
});

// Logger: auto-inject request ID
Logger.for('UserService').info('User created');
// Output: { requestId: "abc-123", name: "UserService", msg: "User created" }
```

#### C. No Shutdown Timeout

`server.close()` waits indefinitely for connections to drain. A slow client keeps the server alive forever.

**Fix:**
```typescript
async shutdown(timeoutMs = 30_000): Promise<void> {
  const timer = setTimeout(() => {
    logger.warn('Shutdown timeout reached, forcing exit');
    process.exit(1);
  }, timeoutMs);

  await this.callHook('shutdown');
  await new Promise<void>((resolve) => this.httpServer.close(() => resolve()));
  clearTimeout(timer);
}
```

#### D. CORS Defaults Are Unsafe

CORS defaults to `origin: '*'` (allow all). Production apps should fail closed.

**Fix:** Default to restrictive, require explicit opt-in:
```typescript
// Default: reject cross-origin
cors({ origin: false })

// Dev: explicit wildcard
cors({ origin: process.env.NODE_ENV === 'development' ? '*' : false })
```

### 16.3 Important Gaps (Should Fix)

#### E. Rate Limiting is In-Memory Only

The default `MemoryStore` for rate limiting doesn't work with multiple processes or containers. Each instance has its own counter.

**Fix:** Provide a Redis rate-limit store adapter:
```typescript
class RedisRateLimitStore implements RateLimitStore {
  constructor(private redis: RedisClient) {}
  async increment(key: string): Promise<{ count: number; resetTime: number }> {
    const count = await this.redis.incr(key);
    if (count === 1) await this.redis.pexpire(key, this.windowMs);
    return { count, resetTime: Date.now() + this.windowMs };
  }
}
```

#### F. No Database Connection Health Checks

Prisma/Drizzle adapters don't verify connectivity after initial connection. A dropped connection is only discovered when a request fails.

**Fix:** Add periodic health pings in adapters:
```typescript
// In PrismaAdapter
private healthInterval?: NodeJS.Timeout;

afterStart() {
  this.healthInterval = setInterval(async () => {
    try { await this.prisma.$queryRaw`SELECT 1`; }
    catch { logger.error('Database health check failed'); }
  }, 30_000);
}
```

#### G. OTel Only Traces HTTP

No automatic spans for database queries, queue jobs, or cache operations. Makes distributed tracing incomplete.

**Fix:** Add instrumentation hooks in Prisma/Drizzle/Queue adapters:
```typescript
// Prisma middleware for auto-tracing
this.prisma.$use(async (params, next) => {
  const span = tracer.startSpan(`prisma.${params.model}.${params.action}`);
  try { return await next(params); }
  finally { span.end(); }
});
```

#### H. No Process Management Documentation

No guidance on clustering, Docker, Kubernetes, or PM2. Users are left to figure it out.

**Fix:** Add a deployment guide covering:
- Dockerfile example (multi-stage, non-root user)
- Kubernetes deployment + service + probes YAML
- PM2 ecosystem.config.js
- Docker Compose with Redis + Postgres

### 16.4 What's Already Production-Grade

These areas need no changes:

- **Graceful shutdown** — Adapter hooks, `Promise.allSettled()`, DB disconnect, signal handling
- **Zod validation** — Schema-driven, typed errors, automatic 422 responses
- **Pino logging** — Structured JSON, log levels, named loggers
- **DI container** — Singleton/transient scopes, circular dep detection, HMR support
- **Database adapters** — Prisma 5/6/7, Drizzle multi-driver, query adapters with pagination
- **Queue system** — BullMQ, worker management, job decorators
- **Security headers** — Helmet-equivalent, HSTS, CSP support
- **CSRF protection** — Double-submit cookies, configurable paths
- **Test utilities** — Isolated containers, module overrides, Express integration

### 16.5 Production Readiness Checklist

```
  MUST HAVE (blocking production)       Status
  ================================      ======
  Health check endpoint                 MISSING  <- add /health/live + /health/ready
  Shutdown timeout                      MISSING  <- add configurable timeout + force exit
  Request context in logs               MISSING  <- add AsyncLocalStorage
  CORS production defaults              UNSAFE   <- change default to origin: false

  SHOULD HAVE (week 1-2)                Status
  ================================      ======
  Distributed rate limiting             MISSING  <- add Redis store adapter
  DB connection health checks           MISSING  <- add periodic ping
  OTel database/queue spans             MISSING  <- add instrumentation hooks
  Deployment guide (Docker/K8s/PM2)     MISSING  <- add documentation

  NICE TO HAVE (later)                  Status
  ================================      ======
  Circuit breaker pattern               MISSING
  W3C trace context propagation         MISSING
  Secrets masking in logs               MISSING
  Mock adapters for testing             MISSING
  Request body size limits              MISSING
```

---

## Key Takeaways for KickJS

**Build & DX:**
1. **Replace Turbo with pnpm + wireit** - Lighter orchestration, per-package caching, no daemon
2. **Migrate library builds to tsdown** - Rolldown/Rust, single-step JS+DTS, `isolatedDeclarations` for near-instant types
3. **Fix rebuild() error recovery** - Build new app fully before swapping listeners (P0)
4. **Preserve manual registrations across HMR** - DB/Redis connections currently lost; add `container.markPersistent()`
5. **Selective HMR invalidation** - Track DI dependency graph, only re-register changed + dependents
6. **Dev/prod build splits** - Strip devtools and debug traces in production
7. **Typegen for DI** - Generate `ContainerTokenMap` for fully typed `container.resolve()` calls
8. **Fix devtools "not instantiated"** - Store `CLASS_KIND`, track `resolveCount`, add SSE + dependency graph

**Production Runtime:**
9. **Add health check endpoint** - `/health/live` + `/health/ready` with DB/Redis/queue checks (P0, blocking)
10. **Add request context via AsyncLocalStorage** - Request ID in every log line, not just request middleware
11. **Add shutdown timeout** - Configurable timeout (default 30s) with forced exit
12. **Fix CORS defaults** - Change from `origin: '*'` to `origin: false` for production safety
13. **Add distributed rate limiting** - Redis store adapter for multi-process deployments
14. **Validate async `@PostConstruct`** - Either reject or properly await
