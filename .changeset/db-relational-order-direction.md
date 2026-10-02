---
'@forinda/kickjs-db': minor
---

Relational queries can sort descending: `asc()` and `desc()` wrap an `orderBy` expression — `orderBy: (_p, eb) => desc(eb.ref('publishedAt'))` — at the top level and inside `with`, on every dialect. Returning an array from `orderBy` (`[desc(eb.ref('priority')), asc(eb.ref('title'))]`), which the type always allowed, now works; it used to throw. An empty array sorts nothing. The relational-query guide's per-relation example used `eb.isNotNull()` and `.desc()`, which don't exist; it now uses `eb('publishedAt', 'is not', null)` and `desc()`.
