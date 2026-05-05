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

## MySQL 8.0+ / MariaDB 10.5+ required

The relational query layer compiles to `JSON_ARRAYAGG`, which shipped in MySQL 8.0 and MariaDB 10.5. `mysqlAdapter()` checks the version on first connection (lazily — no I/O at construction time). Older versions and unparseable strings throw `KickDbError` with code `KICK_DB_RELATIONAL_NOT_SUPPORTED` so adopters get a clear error before any query reaches the compiler.

The version parser (`parseMysqlVersion`) detects MariaDB via the version string and applies the correct floor per flavor:

- **MySQL** — major `>= 8`.
- **MariaDB** — `>= 10.5` (10.0 – 10.4 throw; 10.5+ and 11.x pass).

## Multi-statement migrations

mysql2's default `Pool.query()` rejects multi-statement SQL unless the driver is configured with `multipleStatements: true`. The adapter splits SQL blobs at top-level `;` boundaries (respecting string literals and `--` / C-style block comments) so kickjs-generated migrations apply against default mysql2 settings. Adopters with `multipleStatements: true` on their pool pay no extra cost — the splitter is cheap on small DDL blobs.

## What ships

- **`mysqlDialect({ pool })`** — wraps Kysely's `MysqlDialect`.
- **`mysqlAdapter({ pool })`** — implements `MigrationAdapter` for `@forinda/kickjs-db`'s migration runner (`kick db migrate` + `kickDbAdapter` boot-time apply). Handles `kick_migrations` / `kick_migrations_lock` table creation, lock acquisition, applying SQL in / out of a transaction, plus the version assertion and multi-statement splitting.
- **`parseMysqlVersion(version)`** + **`parseMysqlMajorVersion(version)`** — exposed for adopters who want to run the same check in their own boot logic. The full parser returns `{ flavor, major, minor }` so adopters can branch on MariaDB vs MySQL; the major-only shim is kept for back-compat.
- **`splitMysqlStatements(sql)`** — exposed for adopters who want to run the same multi-statement splitter outside the adapter (custom migration tooling, etc.).
- **Drift detection (`introspect()`) is not yet implemented in v1** — it throws `KickDbError` with code `KICK_DB_INTROSPECT_NOT_SUPPORTED`. Set `driftCheck: 'off'` on the migration runner until a follow-up adds the `information_schema` walk.

## License

MIT © Felix Orinda
