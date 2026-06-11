---
'@forinda/kickjs-prisma': patch
'@forinda/kickjs-drizzle': patch
---

Mark both packages as deprecated. They were early-adoption adapters and are no longer maintained — `@forinda/kickjs-db` is the supported DB layer going forward. Importing either now prints a one-time console warning (suppress with `KICKJS_SUPPRESS_DEPRECATION=1`) and the entry modules carry `@deprecated` JSDoc so editors flag usages. Both packages will be removed in a future major.
