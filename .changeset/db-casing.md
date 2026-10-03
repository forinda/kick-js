---
'@forinda/kickjs-db': minor
---

`casing: 'snake_case'`: camelCase keys in TypeScript over snake_case tables and columns. Set it on `createDbClient` and in `kick.config.ts` `db`.

- **Migrations:** they name tables, columns, keys and foreign keys in snake_case, and re-derive kick/db's own constraint names. Names you wrote are kept.
- **Queries:** they convert both ways through Kysely's `CamelCasePlugin`. It is split around kick/db's plugins so managed columns, codecs and date decoding still work by key, including nested `db.query` rows.
- **Elsewhere:** `createTestDb` / `createPgTestDb` take `casing`, `kick db introspect` renders camelCase keys when it's set, and `extractSnapshot(schema, dialect, { casing })` exposes it programmatically.
