---
'@forinda/kickjs-cli': patch
---

`kick build:netlify` and `kick build:vercel` take the aliases and `define` from the app's `vite.config.ts`, so code that relies on them builds the same as under `kick build`.
