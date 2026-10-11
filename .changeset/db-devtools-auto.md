---
'@forinda/kickjs-db': minor
'@forinda/kickjs-devtools': minor
'@forinda/kickjs-devtools-kit': minor
---

kick/db queries show in the DevTools **Database** tab with no wiring. While the DevTools adapter runs, every `createDbClient` reports `db:query`, `db:slow-query` and `db:query-error` to it — including a client created at import time, before DevTools started. An explicit `createDbClient({ bus })` still takes precedence. devtools-kit adds `getActiveDevtoolsBus()` / `setActiveDevtoolsBus()` in `@forinda/kickjs-devtools-kit/bus/token`.
