---
'@forinda/kickjs-db': patch
---

Tenancy with an `integer()` or `bigint()` tenant column: an insert that gives the tenant column as a number (`{ tenantId: 42 }` while running as tenant `'42'`) is no longer refused as another tenant's row. Migrations for a schema that uses `.colName()` without `casing` no longer snake_case every other column (`projectId` was emitted as `project_id`, while queries still used `projectId`).

If you generated migrations with that behaviour, the next `kick db generate` renames those columns back to their keys. To keep snake_case columns, set `casing: 'snake_case'` instead.
