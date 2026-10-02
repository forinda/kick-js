---
'@forinda/kickjs-db': minor
---

`db.upsert()` and `db.findOrCreate()`.

- `db.upsert(table, { values, target, update?, where? })` inserts a row — or rows — or updates the ones whose `target` key exists, in one statement, and returns them as stored: `ON CONFLICT … DO UPDATE … RETURNING` on Postgres and SQLite, `ON DUPLICATE KEY UPDATE` plus a read-back on MySQL. `update` takes column names (default: every inserted column outside `target`) or values and expressions; `where` targets a partial unique index.
- `db.findOrCreate(table, { where, create? })` returns `{ row, created }`. It's race-safe: a request that loses the race to insert catches the `UniqueViolationError` and reads the winner's row, and inside a transaction the insert runs in a savepoint so losing doesn't abort the transaction on Postgres.
