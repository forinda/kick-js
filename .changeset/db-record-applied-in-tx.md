---
'@forinda/kickjs-db': patch
---

A migration and its `kick_migrations` row commit in one transaction. The row used to be written after the migration's transaction committed, so a crash in between left the migration applied but unrecorded, and the next run failed re-applying it; `migrate down` had the mirror problem. The built-in Postgres, MySQL and SQLite adapters implement a new optional `MigrationAdapter.applyMigrationInTx(sql, bookkeeping)`; a custom adapter without it keeps the old two-step behaviour. A migration with `transaction: false` is still recorded after it runs.
