---
'@forinda/kickjs': patch
---

Type `ctx.req` / `ctx.res` from the runtime registry (`ActiveRuntime['request']` / `ActiveRuntime['response']`) instead of hard-coding Express's `Request` / `Response`. Under the default (unaugmented) Express runtime these resolve to `express.Request` / `express.Response`, so there is no change for existing apps — but a `kick/runtime` typegen augmentation now flips `ctx.req` / `ctx.res` to the active engine's native request/response, completing the §4.3b runtime-typed-context story for the request context. Behavior is unchanged; this is the last type-prep before the Fastify runtime subpath.
