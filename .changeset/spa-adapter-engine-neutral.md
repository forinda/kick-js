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

`clientDir` now falls back to the entry script's package root when the path
misses from `process.cwd()`. `node server/dist/index.js` launched from a
monorepo root resolved `../web/dist` against the root, found nothing, and served
no SPA. cwd stays the primary base (matching how assets and env files resolve),
and both candidates are existence-checked, so this can never silently pick a
directory that is not there.

Three review follow-ups: `Accept` is parsed with q-values, so `text/html;q=0`
(explicitly "not acceptable" per RFC 9110 §12.5.1) no longer receives a
document; the cache middleware uses a single `stat` in a `try`/`catch` rather
than `existsSync` + `statSync`, which could throw mid-request when a deploy
swaps the directory between the two calls; and a path resolving to a directory
with an `index.html` — most importantly `/` itself — is treated as an index
request, so the root document gets `indexCacheControl` instead of falling
through to the static layer's default (`public, max-age=0` under Express).

The cache classifier no longer touches the filesystem per request. It ran a
`statSync` on every non-reserved request, blocking the event loop on a slow or
contended disk. The build directory is static and already snapshotted at mount
(that is where `index.html` is read), so the file list is captured there too and
classification is a `Set` lookup. Membership of that snapshot is also the
containment guard, so the traversal check is now inherent rather than a separate
prefix comparison.

`Accept` handling honours type wildcards (`text/*`, `application/*`) with RFC
9110 §12.5.1 specificity, so an exact `text/html;q=0` still overrides a
permissive wildcard. A bare `*/*` continues to not count at any q — assets are
fetched that way.
