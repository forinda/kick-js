---
'@forinda/kickjs-db': patch
---

`upsert({ update: false })` takes a per-tenant unique key as its `target` — `target: ['tenantId', 'name']` — when the rows leave the tenant column out for tenancy to fill: they're read back by the current tenant. It used to refuse each row for having no `tenantId`.
