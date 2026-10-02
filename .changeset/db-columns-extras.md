---
'@forinda/kickjs-db': minor
---

`columns` and `extras` in relational reads, at every level of `with`.

- **`columns`:** `{ id: true, title: true }` returns only those columns, and `{ passwordHash: false }` returns everything else.
- **`extras`:** `{ postCount: (_u, eb) => … }` adds computed fields from SQL expressions.

The row type follows both: excluded columns disappear, and each extra is typed from its expression. A mix of `true` and `false`, or an unknown column, is refused. `findManyAndCount` counts the same rows.
