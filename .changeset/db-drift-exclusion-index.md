---
'@forinda/kickjs-db': patch
---

Postgres drift check no longer reports the index behind an `EXCLUDE` constraint as an added index. The schema can't declare exclusion constraints, so they're added by hand in a migration, and `kick dev` refused to start with "Schema drift detected: … added" once one was applied.

A schema rendered by `kick db introspect` before this fix may declare such an index as a plain one; the drift check now reports it as removed. Drop it from the schema (it's the constraint's, not yours), or leave it out with `driftIgnore: { indexes: /^name$/ }`.
