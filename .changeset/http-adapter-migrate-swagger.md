---
'@forinda/kickjs-swagger': patch
---

Migrate the swagger adapter onto the engine-agnostic `ctx.http` facade (M2c). The docs UI, ReDoc, and OpenAPI spec endpoints now register via `ctx.http.route(...)`, the swagger-ui-dist assets via `ctx.http.serveStatic(...)`, and the CSP middleware via `ctx.http.use(...)` — instead of building an Express `Router` and reaching for the raw `app`. Behavior is unchanged under the default Express runtime (the CSP header still applies app-wide, exactly as the previous root-mounted docs router did).

The devtools adapter (26 routes + SSE + static SPA) migrates separately as the final M2 step.
