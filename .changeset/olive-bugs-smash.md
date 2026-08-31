---
'@forinda/kickjs-cli': patch
---

`kick typecheck` refreshes generated types before checking.

`kick dev` runs typegen on startup; `kick typecheck` did not. So the moment a
handler was renamed or a module deleted without the dev server running, the
check failed against `.kickjs/types` describing routes that no longer exist:

```
.kickjs/types/kick__routes.ts(12,45): error TS2307: Cannot find module
  '../../src/modules/hello/hello.controller'
src/modules/health/health.controller.ts(11,46): error TS2339: Property 'live'
  does not exist on type 'HealthController'
```

The second one is the trap: it points at correct, current source and claims a
method that does exist is missing, because the stale `KickRoutes` namespace has
no entry for it. The cause is a generated file the developer never edited and
may not know about. A pre-commit hook or a fresh clone hits this every time,
since neither has run the dev server — and a fresh clone has no generated types
at all.

Typegen failures are reported and swallowed rather than aborting: a typegen
problem must not masquerade as a type error, and must not stop the check that
was asked for. `--no-typegen` skips the refresh for a caller that has just run
typegen itself.
