---
'@forinda/kickjs-db': patch
---

`insertSchema` / `updateSchema` / `selectSchema` hold a `decimal(p, s)` / `numeric(p, s)` column to its precision and scale: `decimal(12, 2)` accepts at most 10 digits before the point and 2 after. A third decimal place used to pass validation and be rounded away by the database, and an oversized value failed the insert with a server error; both are now `422` validation issues naming the column. The OpenAPI `pattern` reflects the same bounds. A scale outside 0…precision (Postgres' `numeric(3, 5)`, `numeric(2, -3)`) keeps the plain decimal check and leaves the range to the database.
