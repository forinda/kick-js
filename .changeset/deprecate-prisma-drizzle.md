---
'@forinda/kickjs-prisma': patch
'@forinda/kickjs-drizzle': patch
---

Mark both packages as deprecated in favor of `@forinda/kickjs-db`. Importing either now prints a one-time console warning (suppress with `KICKJS_SUPPRESS_DEPRECATION=1`) and the entry modules carry `@deprecated` JSDoc so editors flag usages. Both packages will be removed in a future major.
