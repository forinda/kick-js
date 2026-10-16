---
'@forinda/kickjs': patch
---

`MiddlewareHandler` returns `unknown` instead of `void | Promise<void>`. The return value was always ignored — a guard stops the request by writing a response and not calling `next()` — but the type rejected `if (!user) return ctx.problem.unauthorized()`, the idiom handlers use, so a guard written that way failed to type-check.
