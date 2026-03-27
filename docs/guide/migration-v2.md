# Migrating to v2.0

KickJS v2.0 unifies `@forinda/kickjs-core` and `@forinda/kickjs-http` into a single `@forinda/kickjs` package with fully typed internals.

## What Changed

| v1.x | v2.0 |
|------|------|
| `@forinda/kickjs-core` + `@forinda/kickjs-http` | `@forinda/kickjs` |
| `AdapterContext.app: any` | `AdapterContext.app: Express` |
| `AdapterContext.server: any` | `AdapterContext.server: http.Server` |
| `MiddlewareHandler<TCtx = any>` | `MiddlewareHandler<TCtx = any>` (unchanged, but typed when using barrel) |
| Two installs | One install |

## Step 1: Update Dependencies

```diff
// package.json
{
  "dependencies": {
-   "@forinda/kickjs-core": "^1.7.0",
-   "@forinda/kickjs-http": "^1.7.0",
+   "@forinda/kickjs": "^2.0.0",
    "@forinda/kickjs-config": "^2.0.0",
    "express": "^5.1.0"
  }
}
```

```bash
pnpm remove @forinda/kickjs-core @forinda/kickjs-http
pnpm add @forinda/kickjs
```

## Step 2: Update Imports

Find and replace across your project:

```diff
- import { Controller, Get, Service, Autowired } from '@forinda/kickjs-core'
- import { bootstrap, RequestContext, buildRoutes } from '@forinda/kickjs-http'
+ import { Controller, Get, Service, Autowired, bootstrap, RequestContext, buildRoutes } from '@forinda/kickjs'
```

```diff
- import { helmet, cors, requestId } from '@forinda/kickjs-http'
+ import { helmet, cors, requestId } from '@forinda/kickjs'
```

```diff
- import type { AppAdapter, AdapterContext } from '@forinda/kickjs-core'
+ import type { AppAdapter, AdapterContext } from '@forinda/kickjs'
```

### Quick sed command

```bash
find src -name "*.ts" | while read f; do
  sed -i "s|from '@forinda/kickjs-core'|from '@forinda/kickjs'|g" "$f"
  sed -i "s|from '@forinda/kickjs-http'|from '@forinda/kickjs'|g" "$f"
  sed -i "s|from '@forinda/kickjs-core/|from '@forinda/kickjs/|g" "$f"
  sed -i "s|from '@forinda/kickjs-http/|from '@forinda/kickjs/|g" "$f"
done
```

## Step 3: Update Adapter Hooks

Adapter hooks now receive `AdapterContext` instead of positional args:

```diff
  class MyAdapter implements AppAdapter {
-   beforeMount(app: Express, container: Container) {
+   beforeMount({ app, container }: AdapterContext) {
      app.use(myMiddleware())
    }

-   beforeStart(app: Express, container: Container) {
+   beforeStart({ container }: AdapterContext) {
      container.registerInstance(MY_TOKEN, myService)
    }

-   afterStart(server: http.Server, container: Container) {
+   afterStart({ server }: AdapterContext) {
+     if (!server) return
      server.on('upgrade', handleUpgrade)
    }
  }
```

`AdapterContext` provides:

| Field | Type | Available in |
|-------|------|-------------|
| `app` | `Express` | all hooks |
| `container` | `Container` | all hooks |
| `server` | `http.Server \| undefined` | `afterStart` only |
| `env` | `string` | all hooks |
| `isProduction` | `boolean` | all hooks |

## Step 4: Sub-path Imports

Sub-path imports changed from package-scoped to unified:

```diff
- import { helmet } from '@forinda/kickjs-http/middleware/helmet'
+ import { helmet } from '@forinda/kickjs/middleware/helmet'

- import { Container } from '@forinda/kickjs-core/container'
+ import { Container } from '@forinda/kickjs/container'

- import { ref, computed } from '@forinda/kickjs-core/reactivity'
+ import { ref, computed } from '@forinda/kickjs/reactivity'
```

## Backward Compatibility

`@forinda/kickjs-core` and `@forinda/kickjs-http` still exist and work in v2.0. They are deprecated but not removed — you'll see a console warning:

```
[kickjs] @forinda/kickjs-core is deprecated. Use @forinda/kickjs instead.
```

They will be removed in v3.0. Migrate at your own pace.

## No Changes Required

These packages are unchanged — no migration needed:

- `@forinda/kickjs-config` — still works the same
- `@forinda/kickjs-swagger` — still works the same
- `@forinda/kickjs-testing` — `createTestApp` still works the same
- All adapter packages (`auth`, `cron`, `prisma`, `drizzle`, etc.)

## New: Typed AdapterContext

The main benefit of v2 — `AdapterContext` fields are now fully typed:

```ts
// v1.x — app is `any`, need to cast
beforeMount(app: any, container: Container) {
  (app as Express).use(myMiddleware())
}

// v2.0 — app is `Express`, no cast needed
beforeMount({ app }: AdapterContext) {
  app.use(myMiddleware())  // fully typed
}
```

`env` and `isProduction` are also available — no more `process.env.NODE_ENV` checks:

```ts
beforeMount({ app, isProduction }: AdapterContext) {
  if (!isProduction) {
    app.use(devOnlyMiddleware())
  }
}
```
