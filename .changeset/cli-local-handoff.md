---
'@forinda/kickjs-cli': patch
---

A `kick` installed globally (or in a parent folder) now hands off to the project's own `@forinda/kickjs-cli` when run inside a project. Before, both CLIs' copies of `@forinda/kickjs` loaded into one process — this one's and the one `kick.config.ts` imports — which printed "@forinda/kickjs-di is loaded twice" and ran the global version instead of the project's.

It hands off only to a project whose `package.json` lists `@forinda/kickjs-cli` — never to a stray `node_modules` in a parent folder — and only to a `bin` inside that package. `KICK_NO_HANDOFF=1` runs the installed copy instead.
