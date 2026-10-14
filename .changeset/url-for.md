---
'@forinda/kickjs': minor
'@forinda/kickjs-cli': minor
---

`ctx.urlFor(name, params?, query?)` and `app.urlFor(...)` build a route's full path (API prefix and version included) from its name, `'Controller.method'`. They fill and encode the `:params` and append an optional query string. An unknown name or a missing param throws. `kick typegen` now emits `KickRoutes.Named`, so names and params are type-checked.
