---
'@forinda/kickjs-cli': patch
---

`kick new --template fullstack` sets `server.strictPort: true` in `server/vite.config.ts`. `web/`'s dev proxy targets the API port, so `kick dev` now fails when that port is taken instead of moving to another one the proxy can't reach.

Scaffolds and `kick add` now record install-script approvals where each package manager reads them, so dependency scripts are not blocked or skipped:

- pnpm 10.26+: `allowBuilds` in `pnpm-workspace.yaml`. Older pnpm 10 releases don't read it and skip the scripts with a warning, as before; run `pnpm approve-builds` there. Standalone `rest`/`minimal` projects now get it, not only fullstack. Without it the non-interactive install blocked every `pnpm exec` / script with `ERR_PNPM_IGNORED_BUILDS`.
- npm 11.19+: `allowScripts` in `package.json`.
- bun: `trustedDependencies` in `package.json`.
- yarn runs dependency scripts, so nothing is written.

Every template approves `@swc/core` and `esbuild`. `kick add swagger` / `--packages swagger` also approves `@scarf/scarf` (a swagger-ui-dist dependency), at the workspace root when run from a workspace member. Answers already in the file are never overridden.
