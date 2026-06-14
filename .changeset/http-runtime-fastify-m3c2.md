---
'@forinda/kickjs': minor
---

Add the **Fastify runtime** — `@forinda/kickjs/fastify` (M3c). Pick the engine at bootstrap with no controller, module, or context-decorator changes:

```ts
import { fastifyRuntime } from '@forinda/kickjs/fastify'
export const app = await bootstrap({ modules, runtime: fastifyRuntime() })
```

- `fastifyRuntime()` implements the full `HttpRuntime` contract over Fastify 5: routes materialize as **native Fastify routes**, `reply` is wrapped in a `RuntimeResponse` so `ctx.json` / `ctx.html` / `ctx.download` / `ctx.problem` work unchanged, and connect middleware (the built-ins + adopter middleware) runs via `@fastify/middie`. Per spec §10, Fastify's built-in pino logger is disabled (`logger: false`) so the kickjs `requestLogger` stays the single log format.
- `fastify` and `@fastify/middie` are **optional peers** (install only when you opt in); the root package never imports them unless this subpath is used.
- `Application` now mounts controller routes through the runtime's engine-neutral `mountRoutes(RouteTable)` instead of always building an Express `Router` — behavior is byte-identical under the default Express runtime (verified by the full suite). Hand-built `route.router` values stay Express-specific and mount as connect middleware.

A conformance suite runs one fixture app under **both** Express and Fastify (routing, the response driver, connect middleware). Express behavior is unchanged.

Known follow-ups (next M3 steps): request-scoped contributors under Fastify (ALS frame across its hook model), `@fastify/multipart` uploads, SSE conformance, the `kick/runtime` typegen plugin, and widening `ApplicationOptions.runtime` from `HttpRuntime<Express>` to generic.
