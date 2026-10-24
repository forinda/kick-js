---
'@forinda/kickjs-db': minor
---

`fk(builder, selfRef('id'))` is checked by the compiler: `table()`, `pgSchema().table()` and `TableBase()` reject a self-reference naming a column the table doesn't have, or one of another type, with the reason on that column. `.references(selfRef('id'))` still works and is checked at runtime, as before.
