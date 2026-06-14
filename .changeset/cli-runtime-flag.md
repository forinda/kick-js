---
'@forinda/kickjs-cli': minor
---

`kick new` now scaffolds the HTTP runtime explicitly. A new `--runtime express|fastify|h3` flag (and interactive prompt, default `express`) controls:

- the generated `src/index.ts` — `bootstrap({ runtime: expressRuntime() })` / `fastifyRuntime()` / `h3Runtime()`, imported from the core package (Express) or the `@forinda/kickjs/fastify` / `@forinda/kickjs/h3` subpath;
- the installed engine peers — Fastify adds `fastify` + `@fastify/middie`, h3 adds `h3` (Express needs nothing extra);
- the REST template's middleware — `express.json()` is only emitted for Express, since Fastify and h3 parse bodies natively (adding it would consume the body stream twice).

Making the runtime explicit means switching engines later is a one-line edit, and the scaffold installs exactly the deps the chosen engine needs.
