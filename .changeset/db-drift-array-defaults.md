---
'@forinda/kickjs-db': patch
---

Drift no longer flags Postgres array defaults. `.default('{}')` on a `text[]` column (live `'{}'::text[]`) and `.defaultSql('ARRAY[]::text[]')` now read back as the defaults they are.
