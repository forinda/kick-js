---
'@forinda/kickjs-db': patch
---

Migrations that lost data or failed:

- A SQLite table rebuild no longer empties the tables that reference it. Swapping the new table in deleted the old rows first, which ran their `ON DELETE` — a cascade emptied the children, a restrict failed the migration. better-sqlite3 now switches foreign keys off around the rebuild (the foreign-key check still guards the result); libsql and D1, where a batch can't switch them, refuse such a rebuild instead.
- Dropping a column that an index, unique or foreign key uses now drops those first; the migration failed on every dialect.
- A foreign key whose `onDelete`, `onUpdate`, columns or target changed is now dropped and added again; the diff ignored it.
- On SQLite and MySQL a text default that looks like a number or a boolean (`'0800'`, `'true'`) stays a string; it was emitted unquoted and stored as `800` / `1`.
- On Postgres, only a quoted literal with a cast (`'{}'::jsonb`) passes through as SQL; any default containing `::` (`'std::string'`) did, giving invalid SQL.
- MySQL's `MODIFY COLUMN` on a serial key keeps `AUTO_INCREMENT`.
- Rolling back migrations applied in the same second reverses them by id.
- A kept table's foreign key to a table being dropped is dropped first, and dropped tables go child before parent; Postgres refused to drop a table still referenced.
- A function default, nested calls included (`floor(rand() * 10)`), is recognised as an expression and parenthesised (`DEFAULT (random())`) on SQLite and MySQL, which take no bare call; MySQL's TEXT and JSON columns take a literal default as `DEFAULT ('{}')`; MySQL defaults escape backslashes.
- `migrate` stops when the database has applied a migration no folder holds (a wrong `migrationsDir`, a deleted folder) instead of treating the rest as pending.

Also fixed after review: a column or table rename no longer drops and re-adds the foreign keys and indexes that use it (Postgres follows a rename; the re-add ran before the rename and failed), and FK/index/check drops come before renames so a down migration renames back first; a down migration re-creates a dropped table's foreign keys; Postgres passes a cast of a call or array through again (`gen_random_uuid()::text`, `now()::date`, `ARRAY[]::text[]`); MySQL `tinyint`, `datetime` and other numeric and time types take numeric and boolean defaults; a default holding a backslash is never treated as a function call.

Behaviour changes:

- On libsql and Cloudflare D1, a migration that rebuilds or drops a table another kept table references is refused before it runs (it used to empty the referencing table through its `ON DELETE CASCADE`, or fail). Run it on a connection with `foreign_keys` off, or split the change so the referenced table isn't rebuilt — see the migrations guide.
- `migrate` (and `kickDbAdapter` with `migrationsOnBoot: 'apply'`) stops when the database has applied a migration no folder holds. Restore the folder, list every folder in `migrationsDir` (it takes an array), or remove the row from the migrations table if the migration was deleted on purpose.
