---
'@forinda/kickjs': patch
---

On h3 and the web fetch entry, the error and not-found handlers run inside the request's AsyncLocalStorage, as on Express and Fastify. An error page whose code uses the request — Inertia's `share()` calling `ctx.set()` or resolving a REQUEST-scoped service — threw `RequestContext.set called outside an AsyncLocalStorage frame` for an unknown URL or a handler that threw.
