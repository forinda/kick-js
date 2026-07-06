---
'@forinda/kickjs-cli': patch
'@forinda/kickjs-client': patch
'@forinda/kickjs': patch
---

fix: `KickRoutes.Api` keys are now module-mount-joined paths

The flat client map keyed on the bare decorator path (`'GET /:id'`) instead of
the mounted path (`'GET /tasks/:id'`) — every mounted controller's typed calls
404'd, and multi-resource apps collided on `/:id`-style keys with routes
silently dropped. Fixed by threading `DiscoveredRoute.mountedPath` through both
scan paths (AST + regex, parity preserved).

Also from the same review pass:

- fresh projects with zero routes now still emit an empty `KickRoutes.Api`, so
  `createClient<KickRoutes.Api>` compiles before the first controller exists
- a controller class named `Api` now triggers a typegen warning (it would
  declaration-merge into the reserved flat map)
- duplicate-route warnings now say what they mean (a genuine runtime verb+path
  conflict) instead of firing false positives across controllers
- client: `ShapeOf` fallback is `never` (was all-`unknown`) — generator/client
  key drift fails loudly at the call site instead of silently untyping calls
- kickjs: `KickRoutes` doc comment updated for the `Api` member + the actual
  generated filename
