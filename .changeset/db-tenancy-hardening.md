---
'@forinda/kickjs-db': patch
---

Close ways around `'column'` tenancy:

- An update or upsert can no longer set the tenant column to another tenant (or to an expression), which handed the row to that tenant.
- A table is filtered however the query spells it — `main.tasks`, `public.tasks`, `TASKS`, `sql.table('tasks')` — and every table of MySQL's multi-table `UPDATE a, b`.
- A tenanted table inside a larger piece of raw SQL in a FROM, and `mergeInto` on a tenanted table, are refused instead of running unfiltered.
- With an integer tenant column, a tenant id the database would read as another number (`'01'`, `'1.0'`, `' 1'`) is refused.

Also: `db.upsert()` throws when a row collides with one it may not update (another tenant's) instead of returning `undefined`; the `'rls'` transaction start quotes the tenant as an escape-string literal, so it reads the same whatever `standard_conforming_strings` is; and a query's abort signal now reaches the driver when a connection is acquired.

Also closed after review: a right, full, inner or cross join on a tenanted table now filters the joined table in WHERE (a right or full join kept every row, whatever its ON said); `sql.id('tasks')` is read as the table it names and filtered, and a tenanted table named in other raw SQL in a FROM, JOIN or target (`` sql`tasks` ``, `sql.raw('tasks')`, `sql.ref('tasks')`) is refused; `INSERT OR REPLACE` / `REPLACE INTO` on a tenanted table are refused; `'-0'` is not an integer tenant id.

Behaviour changes under `'column'` tenancy — each was a way to reach another tenant's rows, and each throws now. Run the statement inside `tenancy.bypass(fn, { reason })` if it really is cross-tenant:

- `mergeInto` on a tenanted table, raw SQL naming a tenanted table in a FROM/JOIN/target, and `INSERT OR REPLACE` / `REPLACE INTO`.
- An update or upsert that sets the tenant column to another tenant, or to an expression.
- A non-canonical tenant id for an integer tenant column (`'01'`, `' 1'`, `'-0'`).
- `db.upsert()` throws (a plain `Error`) when a row collides with one it may not update, instead of returning `undefined`.
