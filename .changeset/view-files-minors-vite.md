---
'@forinda/kickjs-vite': patch
---

`kickViewsPlugin` clears the last build's client files when it rebuilds into the same `outDir` (`vite build --watch`), so old hashed files no longer pile up. An absolute `publicDir` is used as given, not joined under `outDir`.
