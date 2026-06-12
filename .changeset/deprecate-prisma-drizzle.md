---
'@forinda/kickjs-prisma': patch
'@forinda/kickjs-drizzle': patch
---

Mark both packages as deprecated. They were early-adoption adapters and are no longer maintained — wire the ORM directly in your app (BYO), or use `@forinda/kickjs-db`, the built-in Kick ORM, if you prefer to skip external ORMs. Importing either now prints a one-time console warning (suppress with `KICKJS_SUPPRESS_DEPRECATION=1`) and the entry modules carry `@deprecated` JSDoc so editors flag usages. Both packages will be removed in a future major.
