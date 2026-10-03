---
'@forinda/kickjs-db': minor
---

Migration and transaction options.

- **`db.transaction({ readOnly: true }, fn)`:** a read-only transaction (Postgres, MySQL), refused on SQLite.
- **`kick db migrate up --to <migration>` / `migrateUp({ to })`:** applies through a named migration.
- **`migrate down --to <migration>` / `migrateDown({ to })`:** reverses everything after it. `migrateDown` now also returns `reversedAll`.
- **`migrate rollback --all` / `migrateRollback({ all: true })`:** reverses every migration.
- **`migrationsTable`:** in the `db` config or on `pgAdapter` / `mysqlAdapter` / `sqliteAdapter`, it renames the bookkeeping tables. On Postgres it may be schema-qualified. Those tables are left out of introspection and drift.
- **`migrationsDirs` / `migrationsDir: [...]`:** runs several migration folders as one history ordered by id, with drift checked across them.

Also fixed: `kick db` now reads `casing` from the `db` config block. The config resolver used to drop it.
