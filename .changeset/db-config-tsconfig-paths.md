---
'@forinda/kickjs-cli': patch
'@forinda/kickjs-db': patch
---

`kick db migrate` (and every command that calls `db.adapter()`) no longer fails with `Cannot find module '@/config'` when the adapter lazily imports `src/db/client.ts` and that file uses the project's path alias. `kick.config.ts` — in the `kick` CLI and the standalone `kickjs-db` binary — now loads with the project's `tsconfig.json` `paths`, as schemas and seeds already did (which is why `kick db generate` worked).
