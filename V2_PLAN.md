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

## Strategy: Build the Base First

**Do NOT touch existing packages until the unified package is proven stable.**

1. Build `@forinda/kickjs` as a standalone package with its own source
2. All existing packages (`core`, `http`, adapters, examples) stay exactly as-is
3. Test the unified package independently
4. Only after it's stable: migrate consumers and create deprecated shims

---

## Phase 1: Source Merge ✅
- [x] Copy `packages/core/src/*` into `packages/kickjs/src/core/`
- [x] Copy `packages/http/src/*` into `packages/kickjs/src/http/`
- [x] Create unified `packages/kickjs/src/index.ts` barrel exporting everything
- [x] Add `packages/kickjs/vite.config.ts` with all entry points (34 modules)
- [x] Add `packages/kickjs/tsconfig.build.json`
- [x] Update `packages/kickjs/package.json` with sub-path exports, own deps
- [x] Fix internal imports (`@forinda/kickjs-core` → `../core` / `../../core`)
- [x] Clean stale build artifacts from `src/`

## Phase 2: Type Fixes ✅ (the whole point)
- [x] Type `AdapterContext.app` as `Express` (no more `any`)
- [x] Type `AdapterContext.server` as `http.Server` (no more `any`)
- [x] Type `MiddlewareHandler` with `RequestContext` by default (no generic needed)

## Phase 3: Stabilize the Unified Package ✅
- [x] Write tests — 10 vitest tests covering all export categories
- [x] Verify 38/38 exports resolve at runtime (Node ESM)
- [x] Verify in fresh external project (14/14 exports via `file:` protocol)
- [x] Verify all sub-path imports work (container, logger, errors, reactivity, middleware, query)
- [x] Publish alpha: `1.7.1-alpha.0` published to npm with `alpha` tag
- [x] Test alpha install: 18/18 exports resolve from `pnpm add @forinda/kickjs@alpha`

## Phase 4: Migrate Consumers (only after Phase 3 is proven)
- [ ] Update all 16 adapter/plugin packages to import from `@forinda/kickjs`
- [ ] Update all 10 example apps
- [ ] Update CLI generators + project template
- [ ] Run full test suite (836+ tests)

## Phase 5: Deprecated Shims
- [ ] Turn `packages/core` into: `export * from '@forinda/kickjs'` + deprecation warning
- [ ] Turn `packages/http` into: `export * from '@forinda/kickjs'` + deprecation warning
- [ ] Both still published — existing users get warnings, not errors

## Phase 6: Update Docs
- [ ] Update all VitePress guides
- [ ] Update CLAUDE.md, AGENTS.md, CONTRIBUTING.md, RELEASE.md
- [ ] Add migration guide (v1.x → v2.0)

## Phase 7: Release v2.0.0
- [ ] All packages build
- [ ] All tests pass
- [ ] Dry-run release
- [ ] PR dev → main
- [ ] `node scripts/release.js major` (v2.0.0)

---

## File Structure

```
packages/kickjs/
  src/
    index.ts              ← unified barrel (core + http exports)
    core/
      container.ts        ← from core
      decorators.ts       ← from core (MiddlewareHandler typed with RequestContext)
      adapter.ts          ← from core (AdapterContext typed with Express + http.Server)
      logger.ts           ← from core
      errors.ts           ← from core
      interfaces.ts       ← from core
      reactivity.ts       ← from core
      ...
    http/
      application.ts      ← from http
      bootstrap.ts        ← from http
      context.ts          ← from http (RequestContext)
      router-builder.ts   ← from http
      middleware/          ← from http
      query/              ← from http
  vite.config.ts
  tsconfig.build.json
  package.json

packages/core/              ← UNCHANGED until Phase 5
packages/http/              ← UNCHANGED until Phase 5
```

## Learnings
- Shims before stabilization causes Vitest workspace resolution issues
- Build the standalone package first, prove it works, then migrate
- Don't touch working code until the replacement is proven
