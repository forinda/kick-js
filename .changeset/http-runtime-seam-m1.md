---
'@forinda/kickjs': minor
---

Introduce the pluggable HTTP-runtime seam (M1 — seam extraction). Decorators no longer emit an `express.Router` directly: `buildRouteTable()` turns controller metadata into a plain-data `RouteEntry[]`, and an `HttpRuntime` materializes that table onto its engine. `expressRuntime()` is the default and the reference implementation — its materializer rebuilds the exact handler chain the old router builder produced, so behavior is unchanged (the full existing suite passes untouched).

New exports from `@forinda/kickjs`: `expressRuntime`, `buildRouteTable`, `materializeRouter`, and the `HttpRuntime` / `RouteTable` / `RouteEntry` / `RouteMeta` / `CtxHandler` / `ConnectMiddleware` / `RuntimeAppOptions` / `RuntimeCapabilities` types. The public `buildRoutes(controller)` API is unchanged — it now delegates through the Express runtime.

No behavior change and no migration required. This is the foundation for the Fastify / h3 runtimes in later milestones (see `docs/http/spec-http-runtimes.md`).
