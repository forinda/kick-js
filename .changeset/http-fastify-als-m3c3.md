---
'@forinda/kickjs': patch
---

Make request-scoped contributors and `ctx.set` / `ctx.get` work under the Fastify runtime. Fastify runs the route handler outside the connect-middleware chain, so the `requestScopeMiddleware` AsyncLocalStorage frame (which Express relies on) wasn't active inside the handler. The Fastify route handler now establishes the ALS frame itself around the pipeline (reusing the inbound `x-request-id` when present), so REQUEST-scoped DI, context decorators (`defineContextDecorator`), and `ctx.set` / `ctx.get` behave the same on Fastify as on Express. Adds a shared `createRequestStore` helper (used by both the Express middleware and the Fastify runtime) and a conformance test covering contributors under both engines.
