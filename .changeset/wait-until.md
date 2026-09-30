---
'@forinda/kickjs': minor
---

`ctx.waitUntil(promise)` and a standalone `waitUntil()`: keep work running after the response is sent, such as an audit log, an email or an analytics call.

- **Node server:** `shutdown()` waits for this work after draining in-flight requests, within the same `shutdownTimeout`.
- **`createHandler()`:** `fetch(request, platform?)` and `node(req, res, platform?)` take the platform context as a last argument and hand the work to its `waitUntil`. That covers Netlify's `context`, Vercel's request context, and anything with a `waitUntil` method.
- **Web entry:** `WebApp.fetch(request, platform?)` does the same, and `createFetchHandler` now forwards the Workers execution context `(request, env, ctx)`.

A rejected promise is logged with its request id, never left unhandled. `settleBackgroundWork()` and the `PlatformContext` type are exported too.
