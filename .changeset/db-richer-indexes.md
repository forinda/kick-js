---
'@forinda/kickjs-db': minor
---

Richer indexes. Chain options onto `index(…).on(…)` / `unique(…).on(…)`:

- `.where(sql)` makes a partial index (Postgres, SQLite).
- A string key is an expression: `.on('lower(email)')` (all three dialects).
- `.using('gin' | 'gist' | 'hnsw' | …)` sets the index method (Postgres; MySQL takes `btree` / `hash`).
- `.op(key, 'gin_trgm_ops')` sets an operator class (Postgres).
- `.include(...cols)` adds covering columns (Postgres).
- `.concurrently()` (Postgres): `kick db generate` writes each concurrent index change as a migration of its own that runs outside a transaction.

An option the dialect can't express fails when the schema is read. Introspection reads expressions, predicates, methods and `INCLUDE` back on Postgres, and predicates on SQLite.

Behaviour change: an index whose definition changed under the same name is now dropped and recreated by `generate`. Before, the diff compared indexes by name only and missed the change. Drift checks still compare name, uniqueness and plain columns.
