---
'@forinda/kickjs-db': patch
---

`inArray()` / `notInArray()` read their type from the column, not the list. Inside `and()` / `or()` or a `db.query` `where`, a list held in a variable (`ids: string[]`) used to win the inference and reject the column (`TypedColumnRef<string>` is not assignable to `string`); a list of the wrong type is still a compile error.
