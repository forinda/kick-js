---
'@forinda/kickjs': minor
'@forinda/kickjs-devtools': minor
---

Startup timeline. `app.getStartupTimeline()` returns `{ totalMs, steps }` for the last startup: one step for each phase (middleware, modules, routes, error handlers, listen, ready) and one for each adapter hook (`'<Adapter>.beforeStart'` and so on). When startup takes longer than a second, the app logs its three slowest steps. DevTools serves the timeline at `/_debug/startup`.
