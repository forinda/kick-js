---
'@forinda/kickjs-db': minor
'@forinda/kickjs-cli': minor
---

SQLite migration generation, a `migrate review` command, and drift handling for non-Postgres dialects.

- **`kick db generate` now emits SQLite DDL** when `db.dialect: 'sqlite'`. Previously the migration emitter was Postgres-only, so SQLite projects couldn't generate migrations from their schema (only the runner worked). The new `emitSqlite` maps PG types to SQLite affinities, normalises defaults (`gen_random_uuid()` → `(lower(hex(randomblob(16))))`, `false` → `0`, `now()` → `CURRENT_TIMESTAMP`), inlines a single integer PK as `INTEGER PRIMARY KEY` (rowid), and folds foreign keys into `CREATE TABLE` (SQLite has no `ALTER ... ADD CONSTRAINT`). Operations SQLite can't express via `ALTER TABLE` (column type/null/default changes, FK changes on an existing table) throw a clear `SqliteRebuildRequiredError` pointing at `kick db generate --empty` instead of emitting wrong SQL. `generate` now dispatches the emitter by dialect.

- **`kick db migrate review <id>`** marks a migration reviewed: it flips `meta.json.reviewed`, swaps the `-- REVIEWED: false` markers in `up.sql`/`down.sql`, and recomputes the journal hash so all three stay in sync. Previously the only way to review was hand-editing `meta.json`, which left the SQL markers and the hash out of sync (the runner gates on `meta.json.reviewed`, not the comment).

- **Drift detection is skipped for SQLite/MySQL** — only the Postgres adapter implements `introspect()`, so `kick db migrate` no longer fails with "introspection not supported" on those dialects (PostgreSQL keeps the default `error` behaviour).
