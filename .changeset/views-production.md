---
'@forinda/kickjs': patch
---

`ViewAdapter` renders in production builds. It resolved `viewsDir` from the working directory only, so a deployment holding just `dist/` — the Dockerfile `kick new` writes — answered every `ctx.render()` with a 500 ("Failed to lookup view"). It now looks in the project first (`KICK_APP_ROOT` when a Netlify or Vercel function sets it, else the working directory), then beside the running entry file, where `copyDirs: ['src/views']` puts the templates (`dist/src/views`).
