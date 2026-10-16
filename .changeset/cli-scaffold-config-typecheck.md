---
'@forinda/kickjs-cli': patch
---

Scaffolded apps type-check their root config files: `tsconfig.json` now includes `*.config.ts` (with `noEmit` and `allowImportingTsExtensions`, which `vitest.config.ts`'s `./vite.config.ts` import needs), so `kick typecheck` and `tsc` cover `kick.config.ts` and `vite.config.ts`. That surfaced two errors every Inertia app shipped with: `pattern: 'inertia'` was not a `ProjectPattern` (it is now, and generates `rest` modules), and the Inertia `vite.config.ts` passed RegExps to `swc.vite({ exclude })`, whose type takes strings — it now uses the equivalent globs.
