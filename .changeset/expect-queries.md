---
'@forinda/kickjs-db': minor
---

`expectQueries(db, count, fn)` and `captureQueries(db, fn)` in `@forinda/kickjs-db/testing` count the queries a block of code sends, to catch N+1 regressions. On a mismatch the error lists every query that ran. `createTestDb` and `createPgTestDb` now create their clients with events on. A client without events is refused, rather than reporting zero queries.
