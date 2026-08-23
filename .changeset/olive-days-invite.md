---
'@forinda/kickjs-cli': minor
---

Add a `guard-vs-middleware-vs-contributor` skill to the generated agent docs.

Guards had one mention across every generated skill — a row in the docs-lookup
table. Nothing said that KickJS has no guard primitive (a guard is a `(ctx, next)`
middleware attached with `@Middleware()`, not a `CanActivate` class), that
guards run before context contributors on every runtime, or that `ctx.res` is
engine-native so `ctx.res.status(401).json(...)` is Express-only. The new skill
covers the three-way choice, the ordering, and those traps; `kick g guard` /
`g middleware` / `g contributor` are now in the CLI cheatsheet too.
