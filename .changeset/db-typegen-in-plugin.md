---
'@forinda/kickjs-db': minor
'@forinda/kickjs-cli': patch
---

The `kick/db` type generation now ships on `dbCliPlugin` (exported as `kickDbTypegen` from `@forinda/kickjs-db/cli`), so mounting the plugin brings **both** the `kick db` commands and `.kickjs/types/kick__db.d.ts` generation from one opt-in.

Previously the db typegen was a kickjs-cli built-in while the commands lived in the plugin — split across two packages. Now `@forinda/kickjs-db/cli` owns the full db CLI surface. kickjs-cli's `kickDbTypegen` export stays as a re-export shim for back-compat, but it is no longer auto-registered — add `dbCliPlugin` to `kick.config.ts` `plugins: []` to get db types (the same mount that enables the commands).
