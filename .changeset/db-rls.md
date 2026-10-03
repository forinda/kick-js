---
'@forinda/kickjs-db': minor
---

Row-level security in the schema (D.26, Postgres).

- **Declaring:** `policy(name).for(...).to(...).as(...).using(sql).withCheck(sql)` in a table's constraints. `table(name, columns, { rls: true | { force: true } })` turns RLS on, which a policy also does.
- **Roles:** `pgRole(name, { login, createDb, createRole, inherit, bypassRls })` is created by migrations if missing. A role is never dropped, not even by a down migration. `pgRole(name).existing()` refers to one managed elsewhere.
- **Migrations:**
  - Roles come first, policy drops before the table changes, and RLS switches and policy creates last.
  - A changed policy is dropped and re-created.
  - Policies on a table whose shape changes, or whose SQL names such a table, are dropped and re-created around the change.
- **`db.transaction({ settings, role }, fn)`:** `set_config(key, value, true)` and `SET LOCAL ROLE`, scoped to the transaction so they're safe on a pool. They're refused inside an open transaction unless `nested: 'separate'`.
- **Introspection** reads RLS state and policies, and `kick db introspect` renders them. Drift compares policies by name, command, kind and roles, and ignores declared roles.
