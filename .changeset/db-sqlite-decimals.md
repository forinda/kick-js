---
'@forinda/kickjs-db': patch
---

`decimal()`, `numeric()` and `money()` columns on SQLite now read back as strings at the column's scale — `decimal(12, 2)` gives `'0.10'`, as on Postgres and MySQL — instead of the float `0.1` that contradicted their `string` type. SQLite still stores a float, so values are exact up to 15 significant digits.
