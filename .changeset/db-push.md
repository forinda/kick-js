---
'@forinda/kickjs-db': minor
---

`kick db push` (and `pushSchema()`): make a prototyping database match the schema with no migration file. Changes that lose data are asked about (`--accept-data-loss` to agree in advance), renames are asked or named with flags, and a change made to the database some other way since the last push stops it. Refused on a database with migrations applied and with `NODE_ENV=production`.
