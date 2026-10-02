---
'@forinda/kickjs-db': minor
---

Generated and identity columns.

- **`.generatedAlwaysAs(sql, { stored? })`:** a column the database computes from the row. Stored by default; virtual on MySQL, SQLite and Postgres 18+.
- **`.generatedAlwaysAsIdentity()` / `.generatedByDefaultAsIdentity()`:** identity columns, Postgres only.

Generated columns and `ALWAYS` identities type as Kysely's `GeneratedAlways<T>`, so writes are rejected at compile time. `InferInsert`, `insertSchema` and `updateSchema` leave them out.

Migrations change them in place where the database allows: Postgres `SET EXPRESSION` / `DROP EXPRESSION` and `ADD | SET | DROP IDENTITY`, MySQL `MODIFY`, and a SQLite rebuild, which also adds stored generated columns. Introspection reads them back on Postgres and SQLite.

Also fixed: a SQLite table rebuild no longer copies into a generated column, which SQLite refuses.
