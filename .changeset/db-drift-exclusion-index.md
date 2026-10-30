---
'@forinda/kickjs-db': patch
---

Postgres drift check no longer reports the index behind an `EXCLUDE` constraint as an added index. The schema can't declare exclusion constraints, so they're added by hand in a migration, and `kick dev` refused to start with "Schema drift detected: … added" once one was applied.
