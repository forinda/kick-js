---
'@forinda/kickjs-db': minor
---

Views and materialized views (D.25).

- **Declaring:** `view(name, columns, { as })` from the root, and `materializedView(name, columns, { as, constraints })` from `@forinda/kickjs-db/pg`. They're queried through the typed client like tables.
- **Migrations:**
  - Views are created after the tables in declaration order, and dropped before them.
  - A changed definition drops and re-creates the view.
  - A view whose SQL names a table the migration alters, and any view over such a view, is dropped and re-created around the change. Postgres won't alter a column a view uses, and SQLite's table rebuild breaks a view over the table.
  - SQLite creates views after its table rebuilds.
- **Materialized views:** indexes, and `db.refreshMaterializedView(name, { concurrently })`.
- **Introspection** reads views on Postgres, MySQL and SQLite, with columns and materialized-view indexes. `kick db introspect` renders them, and drift compares which views exist.
- Snapshots without views are unchanged.
