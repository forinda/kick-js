---
'@forinda/kickjs-cli': minor
---

`kick add devtools` and `kick new --packages devtools` scaffold DevTools as dev-only: the entry gets `...(__KICKJS_DEVTOOLS__ ? [(await import('@forinda/kickjs-devtools')).DevToolsAdapter()] : [])` in its `adapters` list instead of a static import, `src/devtools.d.ts` references `@forinda/kickjs-vite/globals` for the flag's type, and the package installs as a dev dependency. `kick build` compiles the branch out, so `dist/` carries no DevTools code. `kick add devtools` on an app that already has `DevToolsAdapter()` in its adapters leaves it alone.
