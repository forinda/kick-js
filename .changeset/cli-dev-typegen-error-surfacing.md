---
'@forinda/kickjs-cli': patch
---

`kick dev` no longer silently swallows typegen failures in watch mode. A failed scan or plugin pass now prints a deduplicated console warning ("types in .kickjs/types may be stale") and broadcasts a `kickjs:typegen-error` custom HMR event for DevTools/overlays. Repeated identical failures stay quiet until the error changes or a pass succeeds again.
