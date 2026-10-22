---
'@forinda/kickjs-cli': patch
---

The Inertia template loads pages lazily in the browser: each page is its own chunk, fetched on first visit, instead of every page in the first load. Server rendering keeps them eager.
