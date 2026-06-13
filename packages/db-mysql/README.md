# @forinda/kickjs-db-mysql

> ⚠️ **Deprecated — merged into [`@forinda/kickjs-db`](https://www.npmjs.com/package/@forinda/kickjs-db).**
> This package is now a thin re-export shim kept for one release. Install only
> `@forinda/kickjs-db` (plus the `mysql2` driver) and import from the `/mysql`
> subpath: `import { mysqlAdapter, mysqlDialect } from '@forinda/kickjs-db/mysql'`.
> Importing from this package logs a runtime deprecation warning. It will stop
> being published in a future release.

> MySQL adapter for [`@forinda/kickjs-db`](https://www.npmjs.com/package/@forinda/kickjs-db). **MySQL 8.0+ / MariaDB 10.5+ required.**

Two factories:

- **`mysqlDialect({ pool })`** — query-layer dialect for `createDbClient({ dialect })`.
- **`mysqlAdapter({ pool })`** — `MigrationAdapter` for `kick db migrate` + `kickDbAdapter` boot-time apply.

Both consume an [`mysql2`](https://github.com/sidorares/node-mysql2) pool (or any structurally compatible runtime).

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

`db.query.X.findMany({ with })` round-trips nested rows as parsed JS objects: MySQL's JSON aggregation returns TEXT, but `createDbClient` transparently parses it on the way back so adopters never see the encoded form.

## MySQL 8.0+ / MariaDB 10.5+ required

The relational query layer compiles to `JSON_ARRAYAGG`, which shipped in MySQL 8.0 and MariaDB 10.5. `mysqlAdapter()` checks the version on first connection (lazily — no I/O at construction time). Older versions and unparseable strings throw `KickDbError` with code `KICK_DB_RELATIONAL_NOT_SUPPORTED` so adopters get a clear error before any query reaches the compiler.

The version parser (`parseMysqlVersion`) detects MariaDB via the version string and applies the correct floor per flavor:

- **MySQL** — major `>= 8`.
- **MariaDB** — `>= 10.5` (10.0 – 10.4 throw; 10.5+ and 11.x pass).

## Multi-statement migrations

mysql2's default `Pool.query()` rejects multi-statement SQL unless the driver is configured with `multipleStatements: true`. The adapter splits SQL blobs at top-level `;` boundaries (respecting string literals and `--` / C-style block comments) so kickjs-generated migrations apply against default mysql2 settings. Adopters with `multipleStatements: true` on their pool pay no extra cost — the splitter is cheap on small DDL blobs.

## Adopter-facing exports

- **`parseMysqlVersion(version)`** — full parse returning `{ flavor, major, minor }` for branching on MariaDB vs MySQL.
- **`parseMysqlMajorVersion(version)`** — back-compat shim; major-only result.
- **`splitMysqlStatements(sql)`** — multi-statement splitter for custom migration tooling outside the adapter.

## Notes

- **Drift detection (`introspect()`) is not yet implemented in v1** — it throws `KickDbError` with code `KICK_DB_INTROSPECT_NOT_SUPPORTED`. Set `driftCheck: 'off'` on the migration runner until a follow-up adds the `information_schema` walk.

## License

MIT © Felix Orinda
