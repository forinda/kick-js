---
'@forinda/kickjs-db': patch
---

Seeds, the schema file and TypeScript migrations resolve the project's `tsconfig.json` path aliases (`@/db/client`), including in the app code they import. They failed with "Cannot find module '@/…'" before. Needs jiti 2.7, now the minimum.
