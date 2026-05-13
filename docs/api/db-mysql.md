# @forinda/kickjs-db-mysql

MySQL 8.0+ peer adapter for [`@forinda/kickjs-db`](./db.md). Built on `mysql2/promise`; provides both the query dialect and the migration runner's `MigrationAdapter`.

## Installation

```bash
pnpm add @forinda/kickjs-db-mysql mysql2
```

Peer of `@forinda/kickjs-db@workspace:^`. **Requires MySQL 8.0 or later** — the relational query layer uses `JSON_ARRAYAGG` / `JSON_OBJECT`, which earlier versions lack. The adapter version-checks on first use and fails fast if the server is too old.

## Quick Start

```ts
import mysql from 'mysql2/promise'
import { bootstrap } from '@forinda/kickjs'
import { kickDbAdapter } from '@forinda/kickjs-db'
import { mysqlAdapter, mysqlDialect } from '@forinda/kickjs-db-mysql'

const pool = mysql.createPool({
  host: 'localhost',
  user: 'root',
  password: 'secret',
  database: 'app',
  connectionLimit: 20,
})

export const app = await bootstrap({
  modules,
  adapters: [
    kickDbAdapter({
      schema,
      adapter: mysqlAdapter({ pool }),
      migrationsOnBoot: 'fail-if-pending',
    }),
  ],
})
```

## `mysqlAdapter(options)`

Implements both `MigrationAdapter` and the query-dialect surface.

### `MysqlAdapterOptions`

| Option       | Type         | Description                                                                                        |
| ------------ | ------------ | -------------------------------------------------------------------------------------------------- |
| `pool`       | `Pool`       | A `mysql2/promise` pool (preferred — connection reuse + parallelism)                               |
| `connection` | `Connection` | A single `mysql2/promise` connection (tests / scripts)                                             |
| `database`   | `string`     | Database name used for migration runner + introspection (default: inferred from connection config) |

### Type-only exports

- `MysqlPoolLike` — minimal shape `mysqlAdapter` accepts (mirrors `mysql2`'s pool).
- `MysqlConnectionLike` — minimal shape for single-connection mode.
- `ParsedMysqlVersion` — `{ major, minor, patch, fullVersion }`, returned by `parseMysqlVersion()`.

## `mysqlDialect(options)`

Standalone dialect — use when wiring `createDbClient()` directly:

```ts
import mysql from 'mysql2/promise'
import { createDbClient } from '@forinda/kickjs-db'
import { mysqlDialect } from '@forinda/kickjs-db-mysql'

const pool = mysql.createPool({
  /* ... */
})
const db = createDbClient({ schema, dialect: mysqlDialect({ pool }) })
```

### `MysqlDialectOptions`

| Option | Type   | Description     |
| ------ | ------ | --------------- |
| `pool` | `Pool` | The mysql2 pool |

## Utility exports

### `parseMysqlVersion(versionString) → ParsedMysqlVersion`

Parse the result of `SELECT VERSION()`. Used internally to enforce the MySQL 8+ floor at adapter init.

```ts
import { parseMysqlVersion } from '@forinda/kickjs-db-mysql'

parseMysqlVersion('8.0.36-mysql')
// → { major: 8, minor: 0, patch: 36, fullVersion: '8.0.36-mysql' }
```

### `parseMysqlMajorVersion(versionString) → number`

Convenience wrapper that returns only the major number.

### `splitMysqlStatements(sql) → string[]`

Split a multi-statement SQL string on `;` boundaries while respecting MySQL's quoted-identifier (`` ` ``) and string-literal (`'`, `"`) escaping rules. Used internally by the migration runner; exposed for adopters writing custom migration tooling.

## Dialect capabilities

| Capability                                         | MySQL 8+ support                                                                                                                                                                                               |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Transactions                                       | ✅                                                                                                                                                                                                             |
| Savepoints                                         | ✅                                                                                                                                                                                                             |
| Streaming via cursor                               | ✅ (via mysql2 stream mode)                                                                                                                                                                                    |
| AbortSignal mid-flight cancellation                | Partial — `db.query.*({ signal })` short-circuits the JS-side promise. Server-side `KILL QUERY` integration is not currently wired; the in-flight query completes on the DB even though the JS promise rejects |
| ENUM types                                         | ✅ (MySQL native `ENUM` column type)                                                                                                                                                                           |
| Relational query (`db.query.X.findMany({ with })`) | ✅ via `JSON_ARRAYAGG(JSON_OBJECT(...))` wrapped in `COALESCE(..., JSON_ARRAY())` so empty `many` reads as `[]`                                                                                                |
| `JSONB`                                            | ✅ — kickjs's `jsonb<T>()` maps to MySQL's `JSON` type; the client installs `ParseJSONResultsPlugin` so columns deserialize automatically                                                                      |

### MySQL quirks worth knowing

- **`utf8mb4` is recommended** as the default character set / collation. MySQL's older `utf8` (3-byte) can't store some emoji / supplementary plane characters.
- **`bigint` reads return strings by default.** mysql2 returns `BIGINT` columns as JavaScript strings to avoid precision loss. Either coerce in your repo layer or set `supportBigNumbers: true` + `bigNumberStrings: false` on the connection config (with the precision caveats this implies).
- **Identifier quoting** uses backticks (`` ` ``) not double quotes. The diff engine + introspection handle this transparently; only adopters writing raw SQL need to care.

## Exports

`mysqlAdapter`, `mysqlDialect`, `parseMysqlVersion`, `parseMysqlMajorVersion`, `splitMysqlStatements`. Type-only: `MysqlAdapterOptions`, `MysqlDialectOptions`, `MysqlPoolLike`, `MysqlConnectionLike`, `ParsedMysqlVersion`.
