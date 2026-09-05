---
'@forinda/kickjs-cli': patch
---

Correct three more generator claims that name Express on engine-neutral surfaces.

`kick g adapter`'s `beforeMount` example used `ctx.app.get(…)` with
`res.json(…)` — both Express-only — directly below a docblock promising the
adapter "works on every runtime". It now uses `ctx.http.route(…)`, the seam the
Application builds over whichever runtime is active, and says when reaching for
the engine-native `ctx.app` is the right call. The same hook's `path` option
accepts a string prefix, a RegExp, or an array of either; the docblock described
only the prefix.

`kick --help` described `kick g middleware` as "Express middleware", and the
generated AGENTS.md called adapter middleware "raw Express". Both are
connect-style handlers mounted through the runtime seam, and work under Express,
Fastify and h3 alike.
