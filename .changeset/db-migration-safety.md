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
