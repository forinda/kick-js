---
'@forinda/kickjs': patch
---

Fix `/health/ready` returning 500 on every non-Express runtime.

The built-in health routes used `ctx.res.status(code).json(body)` in three of
their four branches. `ctx.res` is the ENGINE-NATIVE response: under Fastify it
is a `FastifyReply`, which has `.status()` but no `.json()`, so those branches
threw `TypeError: ctx.res.status(...).json is not a function` and the error
handler answered 500.

Readiness probes therefore failed permanently on Fastify — a pod never becomes
ready, which blocks a deployment rather than degrading it. Both draining
branches had the same defect, and they fire during the shutdown window they
exist to cover.

It stayed invisible because the one branch that used the neutral `ctx.json()`
is the happy path of `/health/live` — exactly what a smoke test curls.

All four branches now `return reply(status, body)`. Both runtimes route a
handler's return value through `applyHandlerResult`, so this carries the status
without touching the engine-native response at all — and it is the same
return-style the framework tells adopters to use, rather than a second way of
doing the same thing.

Covered by a runtime matrix over the built-in routes — ready, degraded, a
rejecting adapter check, and both draining paths, on Express and Fastify. The
matrix needs `createTestApp`'s `runtime` option, whose absence is plausibly why
this was never caught.
