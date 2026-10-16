---
'@forinda/kickjs-db': patch
---

Tenancy with an `integer()` or `bigint()` tenant column: an insert that gives the tenant column as a number (`{ tenantId: 42 }` while running as tenant `'42'`) is no longer refused as another tenant's row. Migrations for a schema that uses `.colName()` without `casing` no longer snake_case every other column (`projectId` was emitted as `project_id`, while queries still used `projectId`).
