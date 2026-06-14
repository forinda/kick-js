---
'@forinda/kickjs-cli': patch
---

The post-scaffold "Available:" hint no longer advertises deprecated packages. It was a hardcoded list that included `auth`, `drizzle`, and `prisma` (all deprecated); it's now derived from `PACKAGE_REGISTRY`, filtering out deprecated, core, `:` sub-variants, and db-dialect/schema-lib duplicates — so it can't drift. A test locks it (no deprecated/core names in the list).
