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

The dot rule is replaced by content negotiation. The fallback fires for
`GET`/`HEAD` requests that accept HTML, parsed as media ranges with q-values and
RFC 9110 §12.5.1 specificity: `text/*` is honoured, an exact `text/html;q=0`
overrides a permissive wildcard, and a bare `*/*` never counts at any q — assets
are fetched that way, and treating it as a document request is what returns HTML
for a missing script. `alwaysFallback: true` skips the check entirely for
non-browser clients. Prefix matching is segment-aware.

**Cache headers.** Applied only to paths the static layer will actually serve,
so a missing asset's 404 is no longer labelled `max-age=31536000, immutable`, and
a path resolving to a directory with an `index.html` — most importantly `/`
itself — gets `indexCacheControl` rather than falling through to the static
layer's default (`public, max-age=0` under Express).

Classification touches the filesystem **zero** times per request: the build
directory is static and already snapshotted at mount (where `index.html` is
read), so the file list is captured there and lookup is a `Set.has`. Membership
of that snapshot is also the containment guard, so traversal is rejected
inherently rather than by a prefix comparison. The snapshot walks with
`readdirSync(dir, { withFileTypes: true })` only — the `recursive` option (Node
20.1) and `Dirent.parentPath` (20.12) are both newer than the declared
`node >=20.0`, and the `Dirent.path` alias they replaced is already gone on Node
24, so no single spelling covers the supported range.

`clientDir` resolves from `process.cwd()` as before, falling back to the entry
script's package root when that misses — `node server/dist/index.js` launched
from a monorepo root previously resolved `../web/dist` against the root, found
nothing, and served no SPA. Both candidates are existence-checked, so it can
never silently pick a directory that is not there. An absolute `clientDir` is
normalised, since a trailing slash or a `.`/`..` segment made the containment
check never match and silently dropped every cache header.

Adds 40 tests — the adapter previously had none despite being public API with
its own export path.
