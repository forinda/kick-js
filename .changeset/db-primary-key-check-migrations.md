---
'@forinda/kickjs-db': minor
---

Primary-key and CHECK changes in migrations.

- **Composite and named keys:** `primaryKey(name?).on(t.a, t.b)` in a table's constraints declares a key over several columns, in key order, optionally named (Postgres keeps the name). Declaring a key both this way and with a column's `.primaryKey()` throws.
- **CHECK constraints:** `check(name, expression)` in the constraints. They're created with the table and migrated when added, removed or changed.
- **Key changes migrate:** a changed primary key used to surface only as a column change — Postgres emitted nothing for the key and MySQL a `MODIFY COLUMN` that neither added nor dropped it. It's now its own change: Postgres drops the old constraint before columns are dropped and adds the new one after columns are added; MySQL swaps the key in one statement; SQLite rebuilds the table. Down migrations reverse it.
- **SQLite rebuilds check foreign keys:** a migration that rebuilds a table runs `PRAGMA foreign_key_check` before committing and rolls back if a row points at a missing parent.
- Snapshots of tables without these are unchanged, so existing migration hashes stay valid.
