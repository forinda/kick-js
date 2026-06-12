---
'@forinda/kickjs-db': patch
---

`kick db generate` no longer fails on SQLite for FK-bearing schemas. Inverting a migration now prunes `dropForeignKey` / `dropIndex` entries for tables the same down-set drops outright — `DROP TABLE` removes both, and on SQLite those drops compile to a table rebuild against the post-state snapshot, which no longer contains the table. Every first migration of a schema with foreign keys previously died with `SqliteRebuildRequiredError: no resolved snapshot for table 'X'` while emitting down.sql. Postgres/MySQL down migrations also lose the redundant pre-drop statements.

Additionally, the sqlite adapter's `SqliteStatement.all`/`get` are no longer method-generic, so a real better-sqlite3 v12 `Database` passes `sqliteAdapter` / `sqliteDialect` without casts (same fix as `SqliteIntrospectDb`).
