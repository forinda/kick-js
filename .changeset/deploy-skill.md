---
'@forinda/kickjs-cli': minor
---

Generated projects get a `kickjs-deploy` skill (`.agents/skills/deploy/SKILL.md`). It covers `kick build:netlify` / `kick build:vercel`, the `deploy` config block, and the Cloudflare Workers path — which is a different entry (`@forinda/kickjs/web` over h3 v2, since Workers have no `node:http`), with the two things that decide whether that deploy works: pre-bundling with SWC so decorator metadata survives, and `nodejs_compat` for the `AsyncLocalStorage` request store.

Its red flags are the failures this took to find in production: an `/api/*` route returning `index.html` because `preferStatic` let the SPA rewrite shadow the function, a frontend that builds outside `web/dist` with only one of the three paths updated, and pointing a platform at `src/index.ts`.
