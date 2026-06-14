---
'@forinda/kickjs': minor
---

Route `RequestContext`'s response helpers through an engine-agnostic `RuntimeResponse` driver (M3b) instead of calling Express `res` methods directly — the first half of the request/response driver layer that lets `ctx` run on non-Express engines.

- New `RuntimeResponse` interface (exported), sized so `express.Response` satisfies it structurally. Under the Express runtime the driver IS the response object, so there is no wrapping and no behavior change.
- `RequestContext` gains an optional fourth constructor argument (`responseDriver`); when omitted it defaults to `res`, so every existing `new RequestContext(req, res, next)` call is unchanged. Fastify / h3 runtimes will pass a thin wrapper over their native reply.
- `ctx.json` / `ctx.html` / `ctx.download` / `ctx.render` / `ctx.problem.*` and `ctx.sse()` now write through the driver; their return type is `RuntimeResponse` (Express's `Response` is a superset, so chained `.status().json()` usage keeps working).

Behavior is unchanged under the default Express runtime (full kickjs suite + testing/swagger/mcp/devtools pass). `ctx.req` / `ctx.res` stay as the raw engine objects; retyping them via the runtime registry and the Fastify runtime itself follow in M3c.
