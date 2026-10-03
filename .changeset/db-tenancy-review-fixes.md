---
'@forinda/kickjs-db': patch
---

Tenancy hardening and fixes.

- **`'column'` tenancy:**
  - It also filters the source tables of `UPDATE … FROM` and `DELETE … USING`.
  - An upsert's `DO UPDATE` is held to the tenant's rows, so a conflict on another tenant's row leaves it alone.
  - MySQL's `ON DUPLICATE KEY UPDATE`, `INSERT … SELECT`, `DEFAULT VALUES` and a non-literal tenant value are refused on tenanted tables, because their tenant can't be checked.
- **`'rls'` streams:** a stream left early (`break`) rolls back its short transaction, so the connection never returns to the pool with the tenant still set.
- **`insertSchema`:** the tenant column and `$defaultFn` columns are optional on insert.
- **SQLite view introspection:** handles doubled quotes inside a view's column list.
- **`pgDialect({ cursor })`:** takes `pg-cursor`'s `Cursor`, so `.stream()` works on Postgres.
