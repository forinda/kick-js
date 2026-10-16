---
'@forinda/kickjs-cli': minor
---

Module names are used as typed by default: `kick g module user` creates `src/modules/user/` with route `/user`. Pluralizing is opt-in with `--pluralize` or `modules: { pluralize: true }` in `kick.config.ts`; `--no-pluralize` still forces names as typed when the config turns it on. `kick new` writes `pluralize: false` into the generated `kick.config.ts`.

Migration: projects scaffolded before this release already have `pluralize: true` in `kick.config.ts` and keep generating plural folders. A project without that setting that wants plural folders adds `modules: { pluralize: true }`.
