---
'@forinda/kickjs-db': minor
---

PGlite, a drift ignore list, and a migration lock that recovers from a killed run.

- `@forinda/kickjs-db/pglite`: `pglitePool(new PGlite(...))` wraps an embedded PGlite database as a pool for `pgDialect()` and `pgAdapter()`. PGlite is one connection, so the pool hands it to one caller at a time: a transaction keeps it until it ends, and no other request's statements run inside it.
- `driftIgnore: { tables?, indexes? }`: regular expressions that leave tables and indexes out of the drift check by name, such as indexes an app creates at runtime. Accepted by `migrateLatest()` and the other runners, by `kickDbAdapter`, and by the `db` block of `kick.config.ts`.
- The migration lock no longer stays held forever after a killed run. A run refreshes its lock while it works, and a lock nobody has refreshed for `lockStaleAfter` seconds (default 600) is taken over by the next run. `lockStaleAfter: 0` turns this off. `MigrationAdapter` gains an optional `refreshLock(owner)`, and `acquireLock(owner, staleAfterSeconds?)` takes a second argument; a custom adapter without `refreshLock` keeps the old behaviour.
