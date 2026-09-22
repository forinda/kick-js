---
'@forinda/kickjs-cli': minor
---

`kick build:netlify` and `kick build:vercel` ship with the CLI. Each bundles `src/serverless.ts` with the same Vite + SWC setup as `kick build`, then writes the platform's build output: a Netlify function under `.netlify/v1/functions/`, or a Build Output API v3 tree in `.vercel/output`. Nothing to install and nothing to copy — these replace the hand-rolled `kick-deploy.ts` plugin the serverless guide used to ask for.

Settings come from the project's layout: a workspace member with a sibling `web` package publishes `web/dist`, writes to the workspace root and routes `/api/*`; anything else is API-only, so the function takes every path and the build creates an empty `dist/public` for Netlify to publish. A `deploy` block in `kick.config.ts` overrides any of it (`entry`, `outDir`, `staticDir`, `siteRoot`, `publishDir`, `apiPath`, `external`, `vercelRuntime`).

`kick new` now writes `netlify.toml` and `vercel.json`, adds `build:netlify` / `build:vercel` scripts, and git-ignores `.netlify/` and `.vercel/`. The fullstack root `build` script runs `kick typegen` before building, since `web`'s `tsc` reads `server/.kickjs/types` — without it the first platform build of a fresh clone failed with `Cannot find type definition file for '../server/.kickjs/types/kick__client'`.
