---
'@forinda/kickjs-db': minor
---

`introspect()` now works for SQLite and MySQL, so `kick db introspect` can reverse-engineer a live SQLite / MySQL database into a `schema.ts` (previously Postgres-only — the SQLite/MySQL adapters threw `KICK_DB_INTROSPECT_NOT_SUPPORTED`).

- `introspectSqlite` walks `sqlite_master` + `PRAGMA table_info|index_list|index_info|foreign_key_list` (skips constraint auto-indexes, groups multi-column FKs).
- `introspectMysql` walks `information_schema.{TABLES,COLUMNS,STATISTICS,KEY_COLUMN_USAGE,REFERENTIAL_CONSTRAINTS}`.
- Both are exported (`introspectSqlite` / `introspectMysql`) and wired into their adapters' `introspect()`.

Note: SQLite/MySQL introspection is **lossy** against a code-first snapshot — a `uuid()` column reads back as `text` / `char(36)` — so it powers schema reverse-engineering, not byte-exact drift detection. Drift stays off for those dialects pending a dialect-normalised compare; PostgreSQL drift is unaffected.
