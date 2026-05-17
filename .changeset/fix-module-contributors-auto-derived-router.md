---
'@forinda/kickjs': patch
---

fix(http): preserve module/adapter/global context contributors across auto-derived router builds

When a module returns `{ path, controller }` (auto-derive shape) instead of `{ path, router: buildRoutes(...) }`, the framework calls `buildRoutes(controller)` after `mod.routes()` returns. The internal `_externalContributorSources` slot was being cleared in a `finally` immediately after `mod.routes()` — so by the time `buildRoutes` ran, module-level, adapter-level, and global contributors were dropped from the pipeline. Any class/method-level `dependsOn` against a module-level key surfaced at boot as `MissingContributorError: Missing context contributor '<key>' required by '<dependent>' on route ...`.

The slot lifetime now spans both `mod.routes()` and the subsequent per-route `buildRoutes(controller)` calls, then clears in a single `finally`. Existing modules that pre-built routers inside `routes()` were unaffected (they ran while the slot was still set) — this fix closes the gap for the documented `{ path, controller }` shape and `defineModule({ build: () => ({ contributors, routes }) })` pattern.
