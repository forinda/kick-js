---
'@forinda/kickjs-db': minor
---

Re-export `sql`, `Kysely` and the query types (`Expression`, `ExpressionBuilder`, `KyselyPlugin`, `RawBuilder`, `Sql`, `SqlBool`) from `@forinda/kickjs-db`, so raw SQL and plugins need no import from `kysely`. The docs now import them from kick/db.
