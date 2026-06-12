---
'@forinda/kickjs-vite': minor
'@forinda/kickjs-cli': minor
---

Two dev-loop fixes:

**Typegen-on-save for bare `vite` boots.** The vite plugin array now includes `kickjs:typegen`, which wires the same debounced typegen watcher `kick dev` uses — so projects (or tools) that boot Vite directly no longer run with silently frozen `.kickjs/types`. The engine is the CLI's new exported `createTypegenDevWatcher()`; the plugin resolves `@forinda/kickjs-cli` from the project root at runtime (optional peer — manifest-walk resolution, since the ESM-only exports map defeats `require.resolve`) and quietly stands down when the CLI is absent or when `kick dev` has claimed ownership via `TYPEGEN_OWNER_KEY` (no double-running). A startup catch-up pass covers edits made while no dev server was running.

**Errors now surface on save, not on the next request.** The app module was re-evaluated lazily after HMR/module-discovery invalidation, so a broken save (syntax error, failed import, bootstrap throw) stayed silent until an HTTP request arrived. Both invalidation paths now eagerly re-warm `virtual:kickjs/app` and log the failure (with fixed stacktraces) the moment the save lands — matching the eager startup behavior.
