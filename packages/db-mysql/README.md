# @forinda/kickjs-db-mysql

> mysql2 adapter for `@forinda/kickjs-db` — `MigrationAdapter` + Kysely `MysqlDialect`. **MySQL 8.0+ required.**

Ships the bridge between `@forinda/kickjs-db`'s migration runner / relational query layer and a MySQL 8.0+ database via [`mysql2`](https://github.com/sidorares/node-mysql2) (or any structurally compatible pool).

## Install

```bash
pnpm add @forinda/kickjs-db @forinda/kickjs-db-mysql mysql2
```

## Quick start

```ts
import { createPool } from 'mysql2/promise'
import { createDbClient } from '@forinda/kickjs-db'
import { mysqlAdapter, mysqlDialect } from '@forinda/kickjs-db-mysql'

const pool = createPool({
  host: '127.0.0.1',
  user: 'root',
  password: '...',
  database: 'app',
})

export const db = createDbClient({
  schema, // your declared schema
  dialect: mysqlDialect({ pool }),
})

export const migrationAdapter = mysqlAdapter({ pool })
```

`createDbClient` auto-attaches Kysely's `ParseJSONResultsPlugin` for the MySQL dialect — `db.query.X.findMany({ with })` round-trips nested rows as parsed JS objects rather than JSON-encoded TEXT.

## MySQL 8.0+ required

The relational query layer compiles to `JSON_ARRAYAGG`, which shipped in MySQL 8.0. `mysqlAdapter()` checks the version on first connection (lazily — no I/O at construction time). MySQL 5.x or unparseable versions throw `KickDbError` with code `KICK_DB_RELATIONAL_NOT_SUPPORTED` so adopters get a clear error before any query reaches the compiler.

MariaDB 10.x is treated as supported (its `JSON_ARRAYAGG` shipped in 10.5).

## What ships

- **`mysqlDialect({ pool })`** — wraps Kysely's `MysqlDialect`.
- **`mysqlAdapter({ pool })`** — implements `MigrationAdapter` for `@forinda/kickjs-db`'s migration runner (`kick db migrate` + `kickDbAdapter` boot-time apply). Handles `kick_migrations` / `kick_migrations_lock` table creation, lock acquisition, applying SQL in / out of a transaction, plus the version assertion.
- **`parseMysqlMajorVersion(version)`** — exposed for adopters who want to run the same check in their own boot logic.
- **Drift detection (`introspect()`) is not yet implemented in v1** — it throws `KickDbError` with code `KICK_DB_INTROSPECT_NOT_SUPPORTED`. Set `driftCheck: 'off'` on the migration runner until a follow-up adds the `information_schema` walk.

## License

MIT © Felix Orinda
