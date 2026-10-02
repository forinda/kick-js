---
'@forinda/kickjs-db': patch
---

Booleans work on SQLite. A `boolean()` column is typed `boolean`, but writing `true` failed ("SQLite3 can only bind numbers, strings, bigints, buffers, and null") and reads came back as `1` / `0`. Booleans now bind as `1` / `0` anywhere — values, `where`, raw `sql` — and `boolean()` columns read back as `true` / `false`.
