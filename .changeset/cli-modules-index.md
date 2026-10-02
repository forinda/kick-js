---
'@forinda/kickjs-cli': patch
---

`kick rm module hello` now removes the scaffold's example module — it looked only for a pluralized `hellos/` folder. A module folder that was never pluralized is found under its singular name. The scaffolded `src/modules/index.ts` comment no longer says "Remove HelloModule", which stayed behind after you had.
