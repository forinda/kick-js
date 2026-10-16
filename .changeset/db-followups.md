---
'@forinda/kickjs-db': minor
---

- **`.defaultSql(expression)`** — a default the database evaluates, on any column: `text().defaultSql('gen_random_uuid()::text')`. `.default()` is a value on every dialect.
- **`db.startTransaction()`** — a transaction you finish yourself, with `commit()` and `rollback()`: transaction events, `afterCommit` hooks, savepoints and nested `transaction()` calls work as in `transaction(fn)`, whose guards it shares.
- **`upsert({ update: false })`** — skips a row whose key exists and returns every row as stored (`ON CONFLICT DO NOTHING`; a no-op update on MySQL, not `INSERT IGNORE`).
- **`queryId` and `txId` on query events** — `beforeQuery`, `query`, `slowQuery` and `queryError` pair by `queryId`, and every statement of a `transaction()`, `BEGIN` and `COMMIT` included, carries its `txId`.
- **`createDbClient({ asyncStackTraces: true })`** — a failed query's stack shows where it was built.
- `morphTo` refuses a target whose key can't compare with the id column when the client is created, instead of failing every query on Postgres.
- `kick db generate` takes a column that went from its snake_case name to its key with nothing else changed (`project_id` → `projectId`) as a rename.
- Nested `with` levels don't take `maxDepth`; result extensions only look at a query whose rows can have computed fields.
- Docs: streaming large results with `.stream()`.

Behaviour change: on SQLite and MySQL, a `.default()` on a text column that looks like a call — `text().default('uuid()')` — was evaluated; it's the text now, as on Postgres. An existing column keeps its database default until the table is rebuilt or the default changes, and `kick db generate` warns about each one: switch it to `.defaultSql('uuid()')`.
