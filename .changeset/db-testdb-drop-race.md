---
'@forinda/kickjs-db': patch
---

`createPgTestDb().drop()` no longer surfaces "terminating connection due to administrator command" as an uncaught error. `pool.end()` can resolve before a client's socket closes, and the forced `DROP DATABASE` then terminated that connection after the pool had detached its error listener. Each client now keeps its own listener.
