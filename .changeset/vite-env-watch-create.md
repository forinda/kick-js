---
'@forinda/kickjs-vite': patch
---

`envWatchPlugin()` reloads when an env file is created or deleted, not only when one that existed at startup changes. Creating the first `.env`, or deleting `.env.local`, under `kick dev` now takes effect without a restart.
