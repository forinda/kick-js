---
'@forinda/kickjs-cli': patch
---

Three codegen bugs adopters hit on fresh `kick new` projects:

## 1. `kick g module` now extends the `defineModules()` chain

The orchestrator's array-insertion regex only matched flat `[...]` literals. Adopters whose `src/modules/index.ts` used `defineModules().mount(...)` saw new modules' import lines added but the `.mount(NewModule())` call missing — the new module silently never registered.

Fix: depth-aware scanner detects both shapes. Flat array stays on the existing path; fluent chain gets a balanced-paren walker that handles nested factory calls (`mount(UserModule())`) without the inner parens confusing the boundary.

## 2. New projects default to `defineModules()`

`kick new` and `kick g module` (on a fresh project) now emit:

```ts
import { defineModules } from '@forinda/kickjs'
import { HelloModule } from './hello/hello.module'

export const modules = defineModules().mount(HelloModule())
```

instead of the flat `[HelloModule()]` array. Subsequent `kick g module <name>` invocations append `.mount(<Name>Module())` to the chain. Pinning `modules.style: 'class'` in `kick.config.ts` keeps the legacy flat-array form for adopters who prefer it.

## 3. `kick new` resolves each `@forinda/kickjs-*` package's actual published version

Previously `kick new` pinned every kickjs sibling to the CLI's own version (`^5.4.0` for everything). After per-package independent versioning landed, that under-installs adopters whenever a sibling bumps independently — `@forinda/kickjs@5.5.0` may pair with `@forinda/kickjs-cli@5.4.2` and `@forinda/kickjs-swagger@5.3.1`.

Fix: `kick new` now runs `npm view <name> version` in parallel for every sibling at scaffold time and pins each dep to its own latest. `npm view` failure (offline / unpublished) falls back to the CLI version so the scaffold stays usable.

Bonus: scaffolded `package.json` now starts at `version: '0.0.0'` instead of inheriting the CLI version. Old behaviour produced apps tagged `5.4.0` on day one, breaking adopters' first npm publish.

## 4. Drop `buildRoutes()` mechanics from generated `routes()` JSDoc

The generated `routes()` JSDoc (DDD / REST / CQRS / scaffold) lectured adopters on how the framework derives the Express Router from the controller via `buildRoutes()` — implementation detail, not API documentation. Replaced with a focused breakdown of the **return value shape**: `path` / `controller` / `version` (with the array-form example for multi-route mounting kept).

## 5. Generated agent docs (`CLAUDE.md` / `AGENTS.md` / `kickjs-skills.md`) cover the new module API

The agent-prompt files emitted by `kick new` now describe `defineModule({...})` + `defineModules().mount(...)` as the default module shape, name `kick.config.ts > modules.style: 'define' | 'class'` as the toggle, and point at `kick codemod modules --experimental --apply` for migrating between the two forms. Cheat-sheet rows updated, registry-array snippets switched to the fluent chain (with the class-form alternative kept as the legacy comment), `AppModule` interface row reframed as legacy.

## Tests

257 → 257 (1 existing test updated to match the new `defineModules()` default; 1 new regression test for chain-append on fluent-form registries). Build + typecheck clean.
