---
'@forinda/kickjs': minor
'@forinda/kickjs-mcp': patch
'@forinda/kickjs-queue': patch
---

Migrate the queue and mcp adapters onto the engine-agnostic `ctx.http` facade (M2b), and export the `AdapterHttp` type from `@forinda/kickjs` so adapter authors can type against it.

- `@forinda/kickjs-queue`: the `/_kick/queue/{panel,data}` routes now register via `ctx.http.route(...)` and respond through `ctx.html` / `ctx.json` instead of reaching for the raw Express `app` / `res`.
- `@forinda/kickjs-mcp`: the StreamableHTTP transport endpoints (`<basePath>/messages`) now mount via `ctx.http.mount(...)` — all three verbs in one route table so the engine still auto-answers the OPTIONS preflight. The transport handler reaches `ctx.req` / `ctx.res` for the raw node request/response it needs.

Behavior is unchanged under the default Express runtime. Swagger and devtools migrate in M2c.
