---
'@forinda/kickjs': minor
'@forinda/kickjs-cli': patch
---

The Fastify and h3 runtimes no longer depend on `express`. Their `serveStatic` used `express.static`, which forced `express` to be installed even on a pure Fastify/h3 app — defeating the point of swapping the engine. They now use `serve-static` (the standalone connect middleware that `express.static` wraps), bridged through middie / `fromNodeMiddleware` exactly as before. `serve-static` is a new optional peer of `@forinda/kickjs`.

CLI scaffolding follows suit: `kick new --runtime fastify|h3` now installs `serve-static` instead of `express` (and drops the `@types/express` devDependency) — an Express scaffold still gets `express`. The alpha-channel pins for the runtime toolchain (`@forinda/kickjs`, `-cli`, `-vite`) are now `^`-ranges rather than exact versions, so a generated project floats to newer alphas and auto-graduates to the stable release once it ships.
