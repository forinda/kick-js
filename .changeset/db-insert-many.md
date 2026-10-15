---
'@forinda/kickjs-db': minor
---

- **`db.insertMany(table, rows, options?)`** inserts any number of rows in as few statements as the dialect's bind-parameter limit allows (65,535 on Postgres and MySQL, 32,766 on SQLite), in one transaction. It joins an open one. It returns the count, or the rows with `returning: true` (Postgres and SQLite). `maxParams` and `atomic: false` handle drivers with lower limits or no transactions, such as Cloudflare D1.
- **`db.upsert()`** with many rows splits them the same way.
