---
'@forinda/kickjs-cli': patch
---

`kick new` no longer prints "Warning: Failed to load kick.config.ts: Cannot find module '@forinda/kickjs-cli'" (three times) when scaffolding with `--no-install`. The same applied to running a global `kick` in a project whose dependencies aren't installed yet. When the project can't resolve `@forinda/kickjs-cli`, the config loader now uses the running CLI for it, so `defineConfig` imports load. An installed copy still resolves normally.

Internally, the project files that don't depend on `kick new` options (tsconfig, formatter/editor/git config, `.env` files, vitest config, the hello module) now ship as real files under the CLI's `templates/base/`. The scaffolded output is unchanged, except that `tsconfig.json` and `.oxfmtrc.json` now end with a newline.
