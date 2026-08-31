---
'@forinda/kickjs-cli': patch
---

Stop generated docs and `kick explain` from teaching the Express-only test
pattern.

Every scaffolded sample drove `request(expressApp)`. The HTTP engine is
pluggable, so under Fastify or h3 that is the wrong object — and generated docs
are copied before anyone reads a guide, which propagates the pattern into
projects that never see the corrected documentation.

The project docs the CLI writes, and the `kick explain` known-issue snippets,
now destructure `app` and drive `request(app.handle.bind(app))`, which follows
whichever runtime the app is configured with. A test pins every CLI-emitting
source so a sample cannot regress.

Pairs with the `runtime` option on `createTestApp` in `@forinda/kickjs-testing`.
