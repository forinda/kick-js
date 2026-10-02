---
'@forinda/kickjs-cli': patch
---

`kick add sqlite` and new apps' TypeScript settings.

- **`kick add sqlite` works under pnpm 10+:** it now approves better-sqlite3's install script (a native addon); the install used to stop with `ERR_PNPM_IGNORED_BUILDS`.
- **Driver types come along:** `kick add sqlite` and `kick add pg` also install `@types/better-sqlite3` / `@types/pg` as dev dependencies.
- **An unfinished install says so:** `kick add` ended with "Done!" even when the install failed; it now reports the failure and exits non-zero.
- **New apps no longer set `declaration: true`:** an app is bundled, not published, and the flag made exporting a repository whose type mentions Kysely fail with TS2883 ("cannot be named… not portable").
