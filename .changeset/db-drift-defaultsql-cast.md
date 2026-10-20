---
'@forinda/kickjs-db': patch
---

Drift check: a Postgres `.defaultSql()` default with a cast, such as `jsonb().defaultSql("'{}'::jsonb")`, no longer reports drift on every migration. Introspection reads `'{}'::jsonb` back as `{}`, while the snapshot kept the SQL as written; the check now reads the snapshot's `.defaultSql()` defaults the same way introspection does.
