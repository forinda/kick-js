---
'@forinda/kickjs': patch
---

h3 v2 runtime (`h3WebRuntime`, `@forinda/kickjs/web`) catches up with the other engines:

- Uploaded files are `Buffer`s on Node, Bun and Deno, so `ctx.file.buffer.toString()` is the content.
- An async `onError` / `onNotFound` is awaited; one that rejects answers 500.
- What connect middleware sets on the request (`session`, `user`, an adapter's data) reaches route handlers and the error / not-found handlers, on the node and fetch paths.
- A middleware or static directory mounted at a path sees `req.url` relative to it, as on Express — static files under a prefix (`/assets/...`) are found.
- Behind a node host (`kick dev`, `app.handle(req, res, next)`) unmatched requests are handed back unless `notFoundFallthrough: false`, like the v1 and Fastify runtimes.
- `server: { tls, http2: true }` works.
- No more `MaxListenersExceededWarning` from h3's per-middleware listeners.
