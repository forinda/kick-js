---
'@forinda/kickjs-devtools': minor
---

DevTools now runs on every HTTP runtime: Express, Fastify, and h3.

Every `/_debug/*` endpoint used to answer through Express's `req` / `res`, and the dashboard files were served with `express.static`, so the adapter only worked on the Express runtime. Now:

- Routes answer through `RequestContext`: `ctx.json`, `ctx.html`, and `ctx.sse()` for the three live streams.
- The heap snapshot streams through `ctx.sendResponse`, with backpressure. It is never buffered whole in memory.
- The dashboard files are served with `http.serveStatic`.
- The token guard runs inside each route, so it no longer depends on how an engine parses the request path and query.
- Per-route latency is keyed by the matched route pattern on every engine. It reads the slot each runtime publishes for `ctx.route`, instead of Express's `req.route`.

**Peer dependencies:** `express` is no longer a peer. `@forinda/kickjs` now requires `>=8.6.0` (was `>=8.2.0`), the first release with `ctx.sendResponse`.

**Also fixed on Express:** `GET /_debug` used to be answered by the static middleware with a 301 redirect. That meant the page with `data-base` injected was never served, which broke custom `basePath` mounts. The dashboard route now owns the page on every engine, and only `assets/` is served statically.
