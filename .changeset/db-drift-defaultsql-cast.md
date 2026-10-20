---
'@forinda/kickjs-db': patch
---

Drift check on Postgres defaults:

- A `.defaultSql()` cast literal, such as `jsonb().defaultSql("'{}'::jsonb")`, no longer reports drift on every migration. Introspection reads it back as `{}`, while the snapshot kept the SQL as written; the check now reads it the same way. So does a quoted literal holding `::` (`.defaultSql("'a::b'")`). A cast expression that matches the database (`gen_random_uuid()::text`) still reports drift.
- A literal replaced by an expression, or the other way round, is now caught even when both normalise to the same text — say `'(gen_random_uuid())'::text` and `gen_random_uuid()::text`. Introspected Postgres columns carry `defaultRaw`, the default exactly as the database reports it, which the check uses to tell the two apart.
