---
'@forinda/kickjs-cli': minor
---

fix: generated controllers use return-value handlers, so `KickRoutes[...].response` infers a real type

`kick typegen` fills `KickRoutes[...].response` with `InferHandlerResponse<Controller['method']>`, which reads the handler's **return type** and nothing else. Every controller the CLI scaffolded wrote its response imperatively, so adopters got no response typing at all — and in one case got worse than nothing:

| Generated handler          | Old inferred `response`                                                                         |
| -------------------------- | ----------------------------------------------------------------------------------------------- |
| `ctx.json(result)`         | `unknown`                                                                                       |
| `ctx.created(result)`      | `unknown`                                                                                       |
| `ctx.noContent()`          | `unknown`                                                                                       |
| `return ctx.notFound(...)` | `RuntimeResponse` — the framework's internal response driver, leaked into the public route type |

Controllers now return their payload, use `reply.created()` / `reply.noContent()` for non-200 statuses, and route error branches through `ctx.problem.*` (RFC 9457) with a bare `return`, which keeps the 404 out of the success type. `getById` now infers the entity type, `create` the created entity, `remove` `undefined`.

Affects `kick g module` (rest + minimal patterns), `kick g controller`, `kick g scaffold`, and the `kick g contributor --type http` usage example.

Also: the minimal pattern now scaffolds the full CRUD surface (`list` / `getById` / `create` / `update` / `remove`) in its single controller file — "minimal" refers to the file count, not the route surface.

Generated code that already existed is unaffected; this only changes what new scaffolds emit.
