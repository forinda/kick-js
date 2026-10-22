---
'@forinda/kickjs': patch
---

Error and not-found handlers run in the request's AsyncLocalStorage store on every engine, so an error page's code (Inertia's `share()`, say) can use the request.

- **h3 and the web fetch entry:** they ran outside any store and threw `RequestContext.set called outside an AsyncLocalStorage frame` for an unknown URL or a handler that threw.
- **Fastify:** a handler's error ran in an outer store. Its `ctx` values were missing there, and REQUEST-scoped services resolved to new instances.
