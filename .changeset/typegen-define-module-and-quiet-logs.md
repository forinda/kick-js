---
'@forinda/kickjs-cli': minor
---

Detect `defineModule()` factory modules in typegen, and quiet per-plugin logs by default.

- **`ModuleToken` now includes v4 `defineModule()` modules.** The scanner previously only recognised the deprecated `class X implements AppModule` form, so a project using the v4 `export const XModule = defineModule({ ... })` idiom emitted `export type ModuleToken = never`. The scanner now also picks up `defineModule()` consts (per-file, so it's cache/incremental-safe), populating `ModuleToken` with each module name.
- **Per-plugin typegen status lines are now debug-only.** `kick typegen` printed a `kick/<id>: <status>` line for every plugin on each run. That list is now gated behind `LOG_LEVEL=debug` (or `trace`); a normal run prints just the one-line `kick typegen → …` summary. Set `LOG_LEVEL=debug` to see the full per-plugin breakdown.
