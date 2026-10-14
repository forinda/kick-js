---
'@forinda/kickjs-inertia': patch
---

The adapter finds its build output (`dist/client`, the SSR bundle) under `KICK_APP_ROOT` when that is set. The functions `kick build:netlify` / `kick build:vercel` write set it, so the build is found wherever the platform starts them.
