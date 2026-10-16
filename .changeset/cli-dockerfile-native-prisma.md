---
'@forinda/kickjs-cli': patch
---

The `Dockerfile` `kick new` writes installs `python3 make g++` in its install stages, so a native addon without a prebuilt binary (`better-sqlite3` after `kick add sqlite`) compiles on `node:22-slim`; the runtime image is unchanged. The production-dependency stage sets `PRISMA_SKIP_POSTINSTALL_GENERATE=1` — it has no Prisma CLI, so `@prisma/client`'s postinstall failed it — and the runtime copies a client generated into `node_modules/.prisma` (and, in a fullstack workspace, `server/node_modules/.prisma`) from the build stage. Existing projects can regenerate the file or add those lines by hand.
