---
'@forinda/kickjs-cli': patch
---

`kick new` and `kick add devtools` install `ws` alongside `@forinda/kickjs-devtools`. DevTools needs it, and yarn 1 doesn't install peers, so a yarn app with DevTools failed under `kick dev` with "Cannot find package 'ws'". An app that also uses `WsAdapter` lists `ws` once, as a dependency.
