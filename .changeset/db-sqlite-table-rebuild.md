---
'@forinda/kickjs-db': minor
---

`kick db generate` now emits a SQLite **table rebuild** for changes SQLite's `ALTER TABLE` can't express — column type/null/default alters and foreign-key add/drop on an existing table. Previously these threw `SqliteRebuildRequiredError` and had to be hand-authored.

The emitter follows SQLite's recommended safe procedure: `CREATE TABLE _kick_new_<t>` with the desired shape → `INSERT ... SELECT` the surviving columns (the old/new column intersection, so data is preserved) → `DROP TABLE` → `RENAME` → recreate indexes. Verified end-to-end: a seeded row survives both `migrate up` and `migrate down` of a column-type change, with indexes intact.

To build the new table the emitter needs the resolved before/after schema, so `generate()` now threads both snapshots into the SQLite emitter (`emitSqlite(changes, { from, to })`). Calling `emitSqlite(changes)` bare with a rebuild-requiring change still throws `SqliteRebuildRequiredError`.

Limitation: the rebuild works for tables without **inbound** foreign-key references (the common case). A table that other tables' FKs point at would need `PRAGMA foreign_keys=OFF` outside the migration transaction — still out of scope.
