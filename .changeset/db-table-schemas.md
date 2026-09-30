---
'@forinda/kickjs-db': minor
---

Validate requests with your tables: `insertSchema`, `selectSchema` and `updateSchema` from the new `@forinda/kickjs-db/schema` subpath.

Each one turns a kick/db table into a schema a route validates with (`@Post('/', { body: insertSchema(notes) })`). Request validation, the Swagger spec, `kick typegen`'s `ctx.body` type and the typed client all take it the way they take a wrapped Zod schema, and it is a Standard Schema too. No schema library is needed.

- **Per-column rules:** each column is checked by its SQL type. `varchar(n)` enforces a length, enums enforce their values, and dates, `bigint` and decimals are parsed to the column's TypeScript type. Nullability and database defaults decide what's required.
- **`columns`:** adds what a table can't say, like `format: 'email'`, lengths, ranges and patterns, or a whole schema for a `json` column.
- **`omit`:** leaves columns out.
- **Row types:** also exports `InferSelect<typeof table>` and `InferInsert<typeof table>`.
