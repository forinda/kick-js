---
'@forinda/kickjs-db': patch
---

Close ways around `'column'` tenancy:

- An update or upsert can no longer set the tenant column to another tenant (or to an expression), which handed the row to that tenant.
- A table is filtered however the query spells it — `main.tasks`, `public.tasks`, `TASKS`, `sql.table('tasks')` — and every table of MySQL's multi-table `UPDATE a, b`.
- A tenanted table inside a larger piece of raw SQL in a FROM, and `mergeInto` on a tenanted table, are refused instead of running unfiltered.
- With an integer tenant column, a tenant id the database would read as another number (`'01'`, `'1.0'`, `' 1'`) is refused.

Also: `db.upsert()` throws when a row collides with one it may not update (another tenant's) instead of returning `undefined`; the `'rls'` transaction start quotes the tenant as an escape-string literal, so it reads the same whatever `standard_conforming_strings` is; and a query's abort signal now reaches the driver when a connection is acquired.
