---
'@forinda/kickjs-db': patch
---

`.default()` with an object or array (`jsonb().default({})`, `jsonb<string[]>().default(['a'])`) stores its JSON text instead of `[object Object]`. An array column takes a Postgres array literal (`integer().array().default([1, 2])` stores `{1,2}`), and a `Date` default stores its UTC time as `2026-01-02 03:04:05.000+00:00`, which Postgres, MySQL and SQLite all accept. `.default()` now accepts the column's own type, so these type-check without a cast.
