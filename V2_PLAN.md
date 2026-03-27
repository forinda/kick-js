# KickJS v2.0 — Unified Package Migration Plan

## Goal
Merge `@forinda/kickjs-core` and `@forinda/kickjs-http` into `@forinda/kickjs`.
This enables fully typed `AdapterContext`, `MiddlewareHandler`, and a single import for the framework.

## Before (v1.x)
```ts
import { Controller, Get, Service } from '@forinda/kickjs-core'
import { bootstrap, RequestContext } from '@forinda/kickjs-http'
import { loadEnv } from '@forinda/kickjs-config'
```

## After (v2.0)
```ts
import { Controller, Get, Service, bootstrap, RequestContext, loadEnv } from '@forinda/kickjs'
```

## Why
- `AdapterContext.app` is `any` because core can't import Express
- `MiddlewareHandler` uses `any` for context because `RequestContext` is in http
- Users always install both packages together
- The umbrella package already exists

---

## Migration Steps

### Phase 1: Source Merge
- [x] Copy `packages/core/src/*` into `packages/kickjs/src/core/`
- [x] Copy `packages/http/src/*` into `packages/kickjs/src/http/`
- [x] Create unified `packages/kickjs/src/index.ts` barrel exporting everything
- [x] Add `packages/kickjs/vite.config.ts` with all entry points (34 modules)
- [x] Add `packages/kickjs/tsconfig.build.json`
- [x] Update `packages/kickjs/package.json` with sub-path exports, own deps (express, pino, etc.)
- [x] Remove old root `index.js` and `index.d.ts`
- [x] Fix internal imports (`@forinda/kickjs-core` → `../core` / `../../core`)

### Phase 2: Type Fixes (the whole point)
- [x] Type `AdapterContext.app` as `Express` (no more `any`)
- [x] Type `AdapterContext.server` as `http.Server` (no more `any`)
- [x] Type `MiddlewareHandler` with `RequestContext` by default (no generic needed)
- [ ] Type `onRouteMount` controllerClass as `Constructor` (already done in v1.7 adapter.ts)

### Phase 3: Deprecated Shims
- [ ] Turn `packages/core/src/index.ts` into: `export * from '@forinda/kickjs'` + deprecation warning
- [ ] Turn `packages/http/src/index.ts` into: `export * from '@forinda/kickjs'` + deprecation warning
- [ ] Both packages keep their `package.json` names and versions (still published)
- [ ] Add `@deprecated` JSDoc to shim exports

### Phase 4: Update Dependents
- [ ] Update all 16 adapter/plugin packages to import from `@forinda/kickjs`
  - auth, cron, devtools, drizzle, graphql, mailer, multi-tenant, notifications, otel, prisma, queue, swagger, cli, testing, ws, vscode-extension
- [x] Update `packages/kickjs/package.json` dependencies (express, pino, multer, cookie-parser, reflect-metadata)

### Phase 5: Update Examples
- [ ] Update all 10 example apps to import from `@forinda/kickjs`
- [ ] Remove `@forinda/kickjs-core` and `@forinda/kickjs-http` from example deps

### Phase 6: Update CLI
- [ ] Update `packages/cli/src/generators/` templates to use `@forinda/kickjs`
- [ ] Update `generateViteConfig()` project template
- [ ] Update `generateKickConfig()` project template

### Phase 7: Update Docs
- [ ] Update all VitePress guides
- [ ] Update CLAUDE.md, AGENTS.md, CONTRIBUTING.md, RELEASE.md
- [ ] Add migration guide (v1.x → v2.0)
- [ ] Update README.md

### Phase 8: Test & Release
- [ ] All 19 packages build
- [ ] All tests pass (836+ tests)
- [ ] Examples build and tests pass
- [ ] Dry-run release
- [ ] Pre-release on dev: `node scripts/release.js prerelease --tag alpha`
- [ ] Promote to main: PR dev → main
- [ ] Release: `node scripts/release.js major` (v2.0.0)

---

## File Structure (After)

```
packages/kickjs/
  src/
    index.ts              ← unified barrel (core + http exports)
    container.ts          ← from core
    decorators.ts         ← from core
    adapter.ts            ← from core (now with typed Express/http.Server)
    logger.ts             ← from core
    errors.ts             ← from core
    interfaces.ts         ← from core
    reactivity.ts         ← from core
    application.ts        ← from http
    bootstrap.ts          ← from http
    context.ts            ← from http (RequestContext)
    router-builder.ts     ← from http
    middleware/            ← from http
    query/                ← from http
  vite.config.ts
  tsconfig.build.json
  package.json

packages/core/              ← DEPRECATED SHIM
  src/index.ts             → export * from '@forinda/kickjs'

packages/http/              ← DEPRECATED SHIM
  src/index.ts             → export * from '@forinda/kickjs'
```

## Risks
- Existing users importing from core/http will get deprecation warnings (not errors)
- Adapter packages need to update their peer deps
- CLI-generated projects will use the new import path
- Bundle size of @forinda/kickjs is larger (includes both core + http)

## Timeline
- Phase 1-2: Source merge + type fixes (1 session)
- Phase 3-4: Shims + dependents (1 session)
- Phase 5-7: Examples + CLI + docs (1 session)
- Phase 8: Test + release (1 session)
