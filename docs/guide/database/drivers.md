# Drivers

`@forinda/kickjs-db` is dialect-agnostic. The actual database connection comes from a driver package, each of which exports two factories:

- a **dialect** — passed to `createDbClient({ dialect })` for the query client.
- an **adapter** — a `MigrationAdapter` passed to `kickDbAdapter()` and used by `kick db migrate*`.

Both factories share the same underlying connection (one pool / handle, no duplicate connections).

| Package                     | Dialect factory | Adapter factory | Driver dependency | Database                   |
| --------------------------- | --------------- | --------------- | ----------------- | -------------------------- |
| `@forinda/kickjs-db/pg`     | `pgDialect`     | `pgAdapter`     | `pg`              | PostgreSQL                 |
| `@forinda/kickjs-db/sqlite` | `sqliteDialect` | `sqliteAdapter` | `better-sqlite3`  | SQLite                     |
| `@forinda/kickjs-db/mysql`  | `mysqlDialect`  | `mysqlAdapter`  | `mysql2`          | MySQL 8.0+ / MariaDB 10.5+ |

Set the matching `dialect` in your `kick.config.ts` `db:` block (`'postgres'`, `'sqlite'`, or `'mysql'`).

## PostgreSQL — `@forinda/kickjs-db/pg`

```bash
pnpm add @forinda/kickjs-db pg
```

```ts
import { Pool } from 'pg'
import { createDbClient } from '@forinda/kickjs-db'
import { pgAdapter, pgDialect } from '@forinda/kickjs-db/pg'
import * as schema from './schema'

const pool = new Pool({ connectionString: process.env.DATABASE_URL })

export const db = createDbClient({
  schema,
  dialect: pgDialect({ pool }),
  events: true,
})

export const migrationAdapter = pgAdapter({ pool })
```

Both factories accept any pg-protocol-compatible pool — `pg.Pool`, `@neondatabase/serverless`'s `Pool`, `pg-cloudflare`, etc. — so you can pick whichever runtime fits.

Postgres is the most complete dialect:

- The relational `db.query` layer (PG `json_agg`) is fully supported.
- `introspect()` works (`kick db introspect`, drift detection).
- The `@forinda/kickjs-db/pg` subpath types are available: `pgEnum`, `tsvector`, `vector(n)`, `citext`, `money`, `inet`, `cidr`, `xml`.
- The built-in CLI migration path uses `pgAdapter` automatically when you set `connectionString` (or `DATABASE_URL`) — no `adapter` factory needed.

## SQLite — `@forinda/kickjs-db/sqlite`

```bash
pnpm add @forinda/kickjs-db better-sqlite3
```

```ts
import Database from 'better-sqlite3'
import { createDbClient } from '@forinda/kickjs-db'
import { sqliteAdapter, sqliteDialect } from '@forinda/kickjs-db/sqlite'
import * as schema from './schema'

const database = new Database('app.db') // or ':memory:'

export const db = createDbClient({
  schema,
  dialect: sqliteDialect({ database }),
})

export const migrationAdapter = sqliteAdapter({ database })
```

Both factories take a `better-sqlite3` handle (or any structurally compatible runtime, e.g. `bun:sqlite`).

Notes:

- `db.query.X.findMany({ with })` works. SQLite returns JSON aggregation as TEXT; `createDbClient` transparently parses it back into JS objects, so you never see the encoded form.
- **`introspect()` works** — `kick db introspect` reverse-engineers the live database into a schema file, and `kick db migrate` runs dialect-normalised drift detection. Introspected types reflect SQLite affinities (a `uuid()` column reads back as `text`), so introspection is best for reverse-engineering; drift comparison normalises both sides to avoid false positives.
- **`kick db generate` emits SQLite DDL** — including the safe table-rebuild for column alters / FK changes SQLite's `ALTER TABLE` can't express.
- The built-in CLI adapter only resolves Postgres from `connectionString`. For SQLite migrations, supply an `adapter` factory in the `db:` block (see [Migrations → Non-Postgres dialects](./migrations#non-postgres-dialects)).

## MySQL / MariaDB — `@forinda/kickjs-db/mysql`

```bash
pnpm add @forinda/kickjs-db mysql2
```

```ts
import { createPool } from 'mysql2/promise'
import { createDbClient } from '@forinda/kickjs-db'
import { mysqlAdapter, mysqlDialect } from '@forinda/kickjs-db/mysql'
import * as schema from './schema'

const pool = createPool({
  host: '127.0.0.1',
  user: 'root',
  password: '...',
  database: 'app',
})

export const db = createDbClient({
  schema,
  dialect: mysqlDialect({ pool }),
})

export const migrationAdapter = mysqlAdapter({ pool })
```

Both factories take a `mysql2` pool (or any structurally compatible runtime).

Notes:

- **MySQL 8.0+ / MariaDB 10.5+ required.** The relational query layer compiles to `JSON_ARRAYAGG`, which shipped in those versions. `mysqlAdapter()` checks the version lazily on first connection and throws `KickDbError` (`KICK_DB_RELATIONAL_NOT_SUPPORTED`) on older servers. The version parser detects MariaDB vs MySQL and applies the correct floor.
- Like SQLite, JSON aggregation returns TEXT and is parsed back transparently.
- **Multi-statement migrations** — mysql2's default `query()` rejects multi-statement SQL. The adapter splits generated migration blobs at top-level `;` boundaries (respecting string literals and comments) so they apply against default mysql2 settings.
- **`introspect()` works** — `kick db introspect` reverse-engineers the live database (via `information_schema`) and `kick db migrate` runs dialect-normalised drift detection. Introspected types reflect the declared MySQL types (`uuid()` reads back as `char(36)`).
- **`kick db generate` emits MySQL DDL** — backtick identifiers, `MODIFY COLUMN` alters, `DROP FOREIGN KEY`, MySQL type mapping.
- The package exports helpers for custom tooling: `parseMysqlVersion(version)`, `parseMysqlMajorVersion(version)`, and `splitMysqlStatements(sql)`.

## Choosing a dialect

- **PostgreSQL** — the default and most complete. Choose it unless you have a specific reason not to: full introspection / drift detection, the richest column-type set (enums, vectors, full-text), and the built-in CLI path.
- **SQLite** — zero-dependency local / embedded use, fast tests (`:memory:`). Full migration support including `generate` (with table rebuilds), `introspect`, and drift detection.
- **MySQL / MariaDB** — when your infrastructure is already MySQL. Mind the 8.0 / 10.5 floor for relational queries.

## Capability summary

| Feature                         | Postgres | SQLite  |      MySQL      |
| ------------------------------- | :------: | :-----: | :-------------: |
| Query builder (`selectFrom`, …) |    ✅    |   ✅    |       ✅        |
| Transactions + savepoints       |    ✅    |   ✅    |       ✅        |
| Relational `db.query`           |    ✅    |   ✅    | ✅ (8.0+/10.5+) |
| `kick db generate` (SQL emit)   |    ✅    |   ✅    |       ✅        |
| Built-in CLI migrate adapter    |    ✅    | factory |     factory     |
| `introspect()` + drift          |    ✅    |   ✅¹   |       ✅¹       |
| `@forinda/kickjs-db/pg` types   |    ✅    |    —    |        —        |

¹ SQLite/MySQL introspection is lossy against a code-first schema (`uuid()` → `text` / `char(36)`); drift comparison normalises both sides so it doesn't false-positive.
