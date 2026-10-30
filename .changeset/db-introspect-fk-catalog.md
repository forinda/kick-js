---
'@forinda/kickjs-db': patch
---

Postgres introspection reads foreign keys from `pg_catalog` instead of `information_schema`. Its constraint views took tens of seconds to minutes per call on a schema with a few hundred tables, and the query ran once per table, so the drift check before `migrationsOnBoot: 'apply'` (and `kick db introspect`) could run for hours and look like `kick dev` hanging. A 377-table, 1497-foreign-key schema now introspects in about 9 seconds. Composite foreign keys now list each column once against the column it references, and two tables with a constraint of the same name no longer mix their columns.
