---
'@forinda/kickjs-db': minor
---

Condition helpers, table aliases and reusable CTEs.

- **Operators:** `eq`, `ne`, `gt`, `gte`, `lt`, `lte`, `like`, `notLike`, `ilike`, `isNull`, `isNotNull`, `inArray`, `notInArray`, `between`, `and`, `or`, `not`, `exists`, `notExists`.
  - Exported from `@forinda/kickjs-db`, and they return Kysely expressions, so they work in `.where()`, join `.on()`, `having`, and `db.query`'s `where`.
  - Operands are type-checked against the column. They can be a table's columns, the `db.query` row argument, any Kysely expression, or a value.
  - Edge cases stay valid SQL: `and()` / `or()` skip `undefined`, and empty `inArray` lists are handled.
- **`alias(table, name)`:** the same table under another name, for self-joins, with `$from` for `selectFrom` and joins.
- **CTEs:** `db.with`, `db.withRecursive` and `db.cte(name, query)` are now on the client, so a CTE can be defined once and spread in: `db.with(...recent)`.
