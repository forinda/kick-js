---
'@forinda/kickjs': minor
'@forinda/kickjs-testing': patch
---

`express` is an optional peer: an app on Fastify or h3 installs and runs without it. An Express app works as before; if `express` is missing, `start()` says so.

To use `buildRoutes()`, `materializeRouter()` or `expressRuntime()` on a plain `express()` app outside a KickJS app — in a test, say — import them from `@forinda/kickjs/express`.

Custom runtimes can implement two new optional `HttpRuntime` methods: `load()`, to import the engine before `createApp()`, and `bodyParsers({ limit })`, for an engine that doesn't parse bodies itself.
