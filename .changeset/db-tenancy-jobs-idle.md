---
'@forinda/kickjs-db': minor
---

Tenancy, continued.

- **Jobs:** tenancy registers as a kickjs job context carrier, so a job dispatched as a tenant runs as that tenant. Needs `@forinda/kickjs` 8.8 for `registerJobContext`; the peer range is now `>=8.8.0`.
- **`'database'` connections:** a tenant's connections close after `tenantIdleMs` unused (default 10 minutes). `maxOpenTenants` caps how many tenants keep connections open, closing the least recently used idle one; tenants with a query in flight are never closed.
- **`'rls'` with `'transaction'` binding:** a lone query is three round trips instead of four, because `BEGIN` and the tenant now go in one simple query, with the tenant quoted as a SQL literal. Costs are measured on the Tenancy page.
