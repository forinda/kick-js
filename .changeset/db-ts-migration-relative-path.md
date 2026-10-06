---
'@forinda/kickjs-db': patch
---

TypeScript migrations (`migration.ts`) run when `migrationsDir` is relative, as `kick.config.ts` usually gives it (`'db/migrations'`). The file was looked up as a package name and failed with "Cannot find module".
