---
'@forinda/kickjs-cli': minor
---

Refresh the `kick add` catalog. `ai` (`@forinda/kickjs-ai` + zod) and `auth` (`@forinda/kickjs-auth` + jsonwebtoken) are now resolvable — `kick add auth` previously reported "Unknown packages" despite the help text suggesting it. Deprecated entries (`auth` → BYO auth via context contributors, `drizzle`/`prisma` → `@forinda/kickjs-db`) still install but print a migration warning and are flagged in `kick add --list --all`. Catalog resolution is exposed as a pure `planAddPackages()` helper with a drift-guard test that fails if an entry stops matching a published workspace package.
