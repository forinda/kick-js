---
'@forinda/kickjs-db': minor
---

Runs on edge and serverless drivers (D.23).

- **`createDbClient({ dialectTag })`:** names the SQL a dialect speaks.
  - Raw Kysely dialects (Neon, D1, libsql, PlanetScale) are still recognised by their adapter.
  - A dialect kick/db can't place now throws and asks for `dialectTag`. Before, it was treated as SQLite and failed at the first query.
- **`asyncSqliteAdapter({ driver })`:** migrations on async SQLite drivers, with `libsqlDriver(client)` for libsql/Turso and `d1Driver(db)` for Cloudflare D1.
  - Each migration is one atomic batch, with its bookkeeping row and, after a table rebuild, a foreign-key check.
  - `introspect()` works over the driver.
  - Passing `kysely` enables TypeScript migrations.
- **`introspectSqliteAsync(query)`:** SQLite introspection over any async driver.
- **`bun:sqlite`:** `sqliteDialect` now returns rows on Bun. Kysely's driver read a better-sqlite3-only field, so every SELECT ran as a write and returned nothing.
- **`generate()` and `check()`:** they reload the schema file, so a second call in the same process sees your edits.
