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

<PmCommand add="@forinda/kickjs-db pg" />

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

<PmCommand add="@forinda/kickjs-db better-sqlite3" />

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

Both factories take a `better-sqlite3` handle, or a `bun:sqlite` `Database` on Bun ([below](#bun-sqlite)).

Notes:

- `db.query.X.findMany({ with })` works. SQLite returns JSON aggregation as TEXT; `createDbClient` transparently parses it back into JS objects, so you never see the encoded form.
- **`introspect()` works** — `kick db introspect` reverse-engineers the live database into a schema file, and `kick db migrate` runs dialect-normalised drift detection. Introspected types reflect SQLite affinities (a `uuid()` column reads back as `text`), so introspection is best for reverse-engineering; drift comparison normalises both sides to avoid false positives.
- **`kick db generate` emits SQLite DDL** — including the safe table-rebuild for column alters / FK changes SQLite's `ALTER TABLE` can't express.
- The built-in CLI adapter only resolves Postgres from `connectionString`. For SQLite migrations, supply an `adapter` factory in the `db:` block (see [Migrations → Non-Postgres dialects](./migrations#non-postgres-dialects)).

## MySQL / MariaDB — `@forinda/kickjs-db/mysql`

<PmCommand add="@forinda/kickjs-db mysql2" />

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

Both factories take the same `mysql2/promise` pool (or any structurally compatible runtime). Pass `timezone: 'Z'` to `createPool` unless your server runs in UTC: mysql2 otherwise reads and writes dates in the Node process's zone.

Notes:

- **MySQL 8.0+ / MariaDB 10.5+ required.** The relational query layer compiles to `JSON_ARRAYAGG`, which shipped in those versions. `mysqlAdapter()` checks the version lazily on first connection and throws `KickDbError` (`KICK_DB_RELATIONAL_NOT_SUPPORTED`) on older servers. The version parser detects MariaDB vs MySQL and applies the correct floor.
- Like SQLite, JSON aggregation returns TEXT and is parsed back transparently.
- **Multi-statement migrations** — mysql2's default `query()` rejects multi-statement SQL. The adapter splits generated migration blobs at top-level `;` boundaries (respecting string literals and comments) so they apply against default mysql2 settings.
- **`introspect()` works** — `kick db introspect` reverse-engineers the live database (via `information_schema`) and `kick db migrate` runs dialect-normalised drift detection. Introspected types reflect the declared MySQL types (`uuid()` reads back as `char(36)`).
- **`kick db generate` emits MySQL DDL** — backtick identifiers, `MODIFY COLUMN` alters, `DROP FOREIGN KEY`, MySQL type mapping.
- The package exports helpers for custom tooling: `parseMysqlVersion(version)`, `parseMysqlMajorVersion(version)`, and `splitMysqlStatements(sql)`.

## Serverless and edge drivers

`createDbClient` takes any Kysely dialect, so the serverless drivers that ship one work as they are. kick/db tells which SQL to compile from the dialect's Kysely adapter (Postgres, MySQL or SQLite). A dialect it can't place throws, and asks for `dialectTag`:

```ts
createDbClient({ schema, dialect: myDialect, dialectTag: 'postgres' })
```

| Database       | Query dialect                                        | Migrations                                | Tested          |
| -------------- | ---------------------------------------------------- | ----------------------------------------- | --------------- |
| libsql / Turso | `LibsqlDialect` from `@libsql/kysely-libsql`         | `asyncSqliteAdapter` + `libsqlDriver`     | ✅              |
| Cloudflare D1  | `D1Dialect` from `kysely-d1`                         | `asyncSqliteAdapter` + `d1Driver`         | ✅ (Miniflare)  |
| `bun:sqlite`   | `sqliteDialect`                                      | `sqliteAdapter`                           | ✅ (CI, on Bun) |
| Neon           | `pgDialect` with `@neondatabase/serverless`'s `Pool` | `pgAdapter` with the same `Pool`          | not in CI       |
| PlanetScale    | `PlanetScaleDialect` from `kysely-planetscale`       | `mysqlAdapter` over a `mysql2` connection | not in CI       |

### libsql / Turso

<PmCommand add="@forinda/kickjs-db @libsql/client @libsql/kysely-libsql" />

```ts
import { createClient } from '@libsql/client'
import { LibsqlDialect } from '@libsql/kysely-libsql'
import { createDbClient } from '@forinda/kickjs-db'
import { asyncSqliteAdapter, libsqlDriver } from '@forinda/kickjs-db/sqlite'
import * as schema from './schema'

const client = createClient({ url: process.env.TURSO_URL!, authToken: process.env.TURSO_TOKEN })

export const db = createDbClient({ schema, dialect: new LibsqlDialect({ client }) })
export const migrationAdapter = asyncSqliteAdapter({ driver: libsqlDriver(client) })
```

In `kick.config.ts`, return the adapter from the `db.adapter` factory with `dialect: 'sqlite'`, and pass `close: () => client.close()` so `kick db` exits when it's done ([Non-Postgres dialects](./migrations#non-postgres-dialects)).

### Cloudflare D1

<PmCommand add="@forinda/kickjs-db kysely-d1" />

```ts
import { D1Dialect } from 'kysely-d1'
import { createDbClient } from '@forinda/kickjs-db'
import * as schema from './schema'

export default {
  async fetch(request: Request, env: { DB: D1Database }) {
    const db = createDbClient({ schema, dialect: new D1Dialect({ database: env.DB }) })
    return Response.json(await db.selectFrom('users').selectAll().execute())
  },
}
```

`asyncSqliteAdapter({ driver: d1Driver(env.DB) })` runs migrations wherever you hold a D1 binding: in a Worker, or in Node through Miniflare or wrangler's `getPlatformProxy()` for a local database.

- **No interactive transactions.** D1 doesn't allow `BEGIN`, so `db.transaction()` throws. A migration still applies all or nothing: the adapter sends it as one `batch`, which D1 runs atomically.
- **Migrations inside a Worker** need their files in the bundle: pass `migrationFiles()` as `migrationsDir` ([No migrations folder at run time](./ci-deploy.md#bundled-migrations)). kick/db's CI runs D1 through Miniflare from Node, not inside a deployed Worker.

### `bun:sqlite` {#bun-sqlite}

```ts
import { Database } from 'bun:sqlite'
import { createDbClient } from '@forinda/kickjs-db'
import { sqliteAdapter, sqliteDialect } from '@forinda/kickjs-db/sqlite'
import * as schema from './schema'

const database = new Database('app.db')
export const db = createDbClient({ schema, dialect: sqliteDialect({ database }) })
export const migrationAdapter = sqliteAdapter({ database })
```

The same factories as `better-sqlite3`: `sqliteDialect` adapts Bun's statements to what Kysely expects.

### Neon and PlanetScale

Neon's `Pool` speaks the Postgres protocol over WebSockets, so `pgDialect({ pool })` and `pgAdapter({ pool })` take it as they take `pg.Pool`. For PlanetScale, query through `kysely-planetscale`'s dialect (recognised as MySQL) and migrate with `mysqlAdapter` over a regular `mysql2` connection. Neither runs in kick/db's CI, so check them against your setup.

### Notes for async SQLite drivers

- **A migration is one batch:** its statements, its `kick_migrations` row, and, after a table rebuild, a foreign-key check. If any of them fails, none apply.
- **Migration SQL is split at top-level `;`.** A hand-written trigger (`BEGIN … ; … END`) won't split correctly. Write it in a TypeScript migration as one ``sql`…`.execute(db)`` statement instead.
- **`introspect()` works** over the driver, as it does on `better-sqlite3`.
- **TypeScript migrations** (`migration.ts`) need a Kysely instance: pass `kysely: new Kysely({ dialect })` to `asyncSqliteAdapter` (`Kysely` is exported from `@forinda/kickjs-db`). They run in a transaction, which D1 doesn't have; set `"transaction": false` in a D1 migration's `meta.json`.

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
