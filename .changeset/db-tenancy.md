---
'@forinda/kickjs-db': minor
---

Multi-tenancy: `defineTenancy({ strategy })` with `'column'`, `'rls'`, `'schema'` or `'database'`, given to both the schema and the client, so handlers and repositories carry no tenant code.

- **`tenantKey(tenancy)`** marks a tenanted table.
  - `'column'` adds the tenant to every select, update and delete on it (joins in their `ON`, every level of `db.query`), and fills or refuses it on insert.
  - `'rls'` generates a forced row-level-security policy, and fills the tenant on insert.
- **`'rls'` binding:** `'transaction'` (default) sets the tenant locally per transaction, which is safe behind PgBouncer-style poolers. `'connection'` sets it once per connection, for pools the app owns.
- **`'schema'`** points each query at the tenant's schema. **`'database'`** routes each tenant to its own database via `dialectFor(id)`, with drivers cached per tenant.
- **The current tenant** defaults to the request's `tenant` value. `tenancy.run(id, fn)` covers jobs, cron, scripts and tests. With no tenant, queries fail closed.
- **`tenancy.bypass(fn, { reason, allowInRequest })`:**
  - a reason is required, and each call goes to the `onBypass` audit hook;
  - it's refused inside a request by default;
  - under `'rls'` it runs on a separate `bypassDialect` (a `BYPASSRLS` role), tagged `application_name = kick-bypass`.
- **`roleCheck`:** under `'rls'`, the client refuses to run as a superuser or `BYPASSRLS` role.
- **`migrateTenants({ tenants, adapterFor })`** and `kick db migrate latest --tenants` (`db.tenants` in `kick.config`) migrate every tenant's schema or database and report failures per tenant.
