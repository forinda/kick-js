---
'@forinda/kickjs-db': minor
---

PGlite, a drift ignore list, and a migration lock that recovers from a killed run.

- `@forinda/kickjs-db/pglite`: `pglitePool(new PGlite(...))` wraps an embedded PGlite database (`@electric-sql/pglite` 0.5.5 or newer, an optional peer) as a pool for `pgDialect()` and `pgAdapter()`. PGlite is one connection, so the pool hands it to one caller at a time: a transaction keeps it until it ends, and no other request's statements run inside it.
- `driftIgnore: { tables?, indexes? }`: regular expressions that leave tables and indexes out of the drift check by name, such as indexes an app creates at runtime. Accepted by `migrateLatest()` and the other runners, by `kickDbAdapter`, and by the `db` block of `kick.config.ts`.
- The migration lock no longer stays held forever after a killed run. A run refreshes its lock while it works, and a lock nobody has refreshed for `lockStaleAfter` seconds (default 600) is taken over by the next run. `lockStaleAfter: 0` turns this off. `MigrationAdapter` gains an optional `refreshLock(owner)` (`false` once another run has taken the lock over, which the runner logs), `acquireLock(owner, staleAfterSeconds?)` takes a second argument, and `releaseLock(owner?)` releases only `owner`'s lock when given one, so a run that was taken over can't release the new holder's. `kick db migrate unlock` still releases unconditionally. A custom adapter without `refreshLock` keeps the old behaviour.
