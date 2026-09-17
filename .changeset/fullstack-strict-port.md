---
'@forinda/kickjs-cli': patch
---

`kick new --template fullstack` sets `server.strictPort: true` in `server/vite.config.ts`. `web/`'s dev proxy targets the API port, so `kick dev` now fails when that port is taken instead of moving to another one the proxy can't reach.

Standalone pnpm projects (`--template rest|minimal`) now get a `pnpm-workspace.yaml` that approves the `@swc/core` and `esbuild` build scripts, like fullstack already did. Without it, pnpm's non-interactive install blocked every `pnpm exec` / script with `ERR_PNPM_IGNORED_BUILDS`.
