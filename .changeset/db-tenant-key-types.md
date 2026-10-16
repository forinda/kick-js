---
'@forinda/kickjs-db': patch
---

Tenancy with an `integer()` or `bigint()` tenant column: an insert that gives the tenant column as a number (`{ tenantId: 42 }` while running as tenant `'42'`) is no longer refused as another tenant's row. Migrations for a schema that uses `.colName()` without `casing` no longer snake_case every other column (`projectId` was emitted as `project_id`, while queries still used `projectId`).

If you generated migrations with that behaviour, your database has snake_case columns (`project_id`) that the schema now names by their keys (`projectId`). Pick one before the next `kick db generate`:

- Keep the snake_case columns: set `casing: 'snake_case'`. Nothing changes in the database.
- Rename them to their keys: run `kick db generate` in a terminal and answer each "Was it renamed?" question with the new name. In CI, pass every column instead: `--rename-column tasks.project_id=projectId`. Without that, a dropped column is only taken as a rename when it is the table's only one, so the others would be dropped and re-added empty.
