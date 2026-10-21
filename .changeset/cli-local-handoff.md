---
'@forinda/kickjs-cli': patch
---

A `kick` installed globally (or in a parent folder) now hands off to the project's own `@forinda/kickjs-cli` when run inside a project. Before, both CLIs' copies of `@forinda/kickjs` loaded into one process — this one's and the one `kick.config.ts` imports — which printed "@forinda/kickjs-di is loaded twice" and ran the global version instead of the project's.

It hands off only to the nearest folder with a `package.json`, when that file lists `@forinda/kickjs-cli` and the folder belongs to the user running `kick` — never past it, so a stray `node_modules` in a parent folder is never run — and only to a `bin` inside that package. `KICK_NO_HANDOFF=1` runs the installed copy instead.
