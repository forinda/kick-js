---
'@forinda/kickjs': minor
'@forinda/kickjs-testing': patch
---

`@forinda/kickjs` no longer loads `express` unless the app runs on it, and `express` is an optional peer: an app on Fastify or h3 installs and runs without it.

- The default runtime loads Express when the app starts, through a dynamic `import()` that `kick build:netlify|vercel` still bundles. Without `express` installed, `start()` fails with a message naming the package and the other runtimes.
- `expressRuntime()`, `buildRoutes()` and `materializeRouter()` from `@forinda/kickjs` load Express with the app. Used on their own — `express().use(buildRoutes(Controller))` in a test — import them from `@forinda/kickjs/express`, which loads it straight away. `buildRoutes()` still builds the route table when called, so a contributor cycle fails at boot.
- `HttpRuntime` gains two optional hooks: `load()`, awaited before the first `createApp()`, and `bodyParsers({ limit })`, which the Express runtime now uses for its JSON, form and text parsers. A runtime that parses no bodies itself and has no `bodyParsers()` gets Express's, as before.
- The engine app is created in `setup()`, not the `Application` constructor; `handle()` before setup throws.
