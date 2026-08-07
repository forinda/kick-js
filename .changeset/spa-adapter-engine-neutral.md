---
'@forinda/kickjs': major
---

SpaAdapter: engine-agnostic, declarative, and three fallback bugs fixed

**The documented usage did not work.** `docs/guide/spa.md` has always shown
`SpaAdapter({ ... })`, but the export was a class — so following the guide threw
`TypeError: Class constructor SpaAdapter cannot be invoked without 'new'`. It is
now a `defineAdapter()` factory, matching both the docs and `ViewAdapter`, which
made the same move in v4. If you were calling `new SpaAdapter({...})`, drop the
`new`.

**It was Express-only.** The adapter reached for `express.static`, `req.path`,
and `res.send` — none of which exist under Fastify or h3 — so on those runtimes
it silently served nothing while the framework advertises a pluggable engine. It
now uses the engine-agnostic `http.serveStatic()` / `http.use()` surface and
reads the path from `req.url`, so it works under all three.

**Three fallback bugs, none previously covered by a test:**

| Request                                   | Before | After             |
| ----------------------------------------- | ------ | ----------------- |
| `GET /users/john.doe`                     | 404    | `index.html`      |
| `HEAD /dashboard`                         | 404    | 200, headers only |
| `GET /apidocs` (with `apiPrefix: '/api'`) | 404    | `index.html`      |

The dot rule is replaced by content negotiation — the fallback fires for
`GET`/`HEAD` requests that accept HTML. A missing `/assets/app.js` still 404s
rather than receiving an HTML document. `alwaysFallback: true` opts out for
non-browser clients. Prefix matching is now segment-aware.

Cache headers are only applied to paths that resolve to a real file inside
`clientDir`, so a missing asset's 404 is no longer labelled
`max-age=31536000, immutable`.

Adds 21 tests — the adapter previously had none despite being public API with
its own export path.
